"""Self-hosted Protomaps basemap (ADR-0028).

Three parts, all written under one output directory whose layout mirrors
what the frontend reads (apps/web/src/basemaps.ts) and what lands in S3
under ``tiles/basemap/``:

- ``protomaps.pmtiles``: a bbox extract of the latest daily planet build
  from https://maps.protomaps.com/builds/. ``pmtiles extract`` reads only
  the tiles inside the bbox, via range requests, so the ~140GB planet is
  never downloaded whole. The extract's header bounds are the bbox, and the
  frontend uses them as the map's ``maxBounds``.
- ``fonts/`` and ``sprites/v4/``: the glyph PBFs and sprite sheets the
  ``@protomaps/basemaps`` styles reference, from the
  ``protomaps/basemaps-assets`` repository.
- ``protomaps.json``: a manifest recording which build, bbox, maxzoom and
  assets commit the directory holds. A rerun with the same inputs skips the
  extract, so the pipeline is safe to rerun and cheap when nothing changed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests

from .proxy import resilient_proxy

BUILDS_METADATA_URL = "https://build-metadata.protomaps.dev/builds.json"
BUILDS_BASE_URL = "https://build.protomaps.com"
ASSETS_REPO = "protomaps/basemaps-assets"

# west, south, east, north. Canary Islands to the Black Sea's western
# shore, Cape Verde's latitude to northern France: Spain with enough of
# Europe and North Africa around it that the map never looks cut off at
# the zooms it is used at.
DEFAULT_BBOX = (-36.650391, 18.271086, 27.070313, 50.233152)
# Protomaps builds stop at z15; MapLibre overzooms past it.
DEFAULT_MAXZOOM = 15

ARCHIVE_NAME = "protomaps.pmtiles"
MANIFEST_NAME = "protomaps.json"


@dataclass(frozen=True)
class Build:
    key: str  # e.g. "20260930.pmtiles"
    size: int
    b3sum: str
    version: str  # the basemap tileset schema version, e.g. "4.15.2"

    @property
    def url(self) -> str:
        return f"{BUILDS_BASE_URL}/{self.key}"


@dataclass(frozen=True)
class Manifest:
    build: str
    build_b3sum: str
    tileset_version: str
    bbox: tuple[float, float, float, float]
    maxzoom: int
    assets_commit: str
    created_at: str


def fetch_builds() -> list[Build]:
    resp = requests.get(BUILDS_METADATA_URL, timeout=60)
    resp.raise_for_status()
    return [
        Build(key=b["key"], size=b["size"], b3sum=b.get("b3sum", ""), version=b.get("version", ""))
        for b in resp.json()
    ]


def pick_build(builds: list[Build], key: str | None = None) -> Build:
    """The named build (``20260930`` or ``20260930.pmtiles``), else the latest.

    Keys are ``YYYYMMDD.pmtiles``, so the latest one is the largest key.
    """
    candidates = [b for b in builds if b.key.endswith(".pmtiles")]
    if not candidates:
        raise ValueError("no PMTiles builds listed")
    if key is None:
        return max(candidates, key=lambda b: b.key)
    wanted = key if key.endswith(".pmtiles") else f"{key}.pmtiles"
    for b in candidates:
        if b.key == wanted:
            return b
    raise ValueError(
        f"build {wanted} not found (latest is {max(candidates, key=lambda b: b.key).key})"
    )


def latest_assets_commit() -> str:
    resp = requests.get(f"https://api.github.com/repos/{ASSETS_REPO}/commits/main", timeout=60)
    resp.raise_for_status()
    return resp.json()["sha"]


def read_manifest(out_dir: Path) -> Manifest | None:
    path = out_dir / MANIFEST_NAME
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    data["bbox"] = tuple(data["bbox"])
    return Manifest(**data)


def needs_extract(
    existing: Manifest | None, archive: Path, build: Build, bbox: tuple[float, ...], maxzoom: int
) -> bool:
    if existing is None or not archive.exists():
        return True
    return (existing.build, tuple(existing.bbox), existing.maxzoom) != (
        build.key,
        tuple(bbox),
        maxzoom,
    )


def extract(
    build: Build, bbox: tuple[float, ...], maxzoom: int, dest: Path, attempts: int = 3
) -> None:
    """``pmtiles extract`` into ``dest``, via a temporary name so a killed run
    never leaves a truncated archive where the frontend (or a later skip
    check) would take it for a finished one.

    Reads through a local proxy (proxy.py) that retries and resumes each
    range request, since build.protomaps.com fails often enough that a
    direct extract, which can't retry, rarely finishes. The whole extract
    is still retried a few times in case the proxy itself gives up."""
    partial = dest.with_name(dest.name + ".partial")
    with resilient_proxy(build.url, build.size) as source:
        cmd = [
            "pmtiles",
            "extract",
            source,
            str(partial),
            f"--bbox={','.join(str(c) for c in bbox)}",
            f"--maxzoom={maxzoom}",
        ]
        for attempt in range(1, attempts + 1):
            partial.unlink(missing_ok=True)
            if subprocess.run(cmd, check=False).returncode == 0:
                break
            if attempt == attempts:
                raise RuntimeError(f"pmtiles extract failed {attempts} times")
            wait = 30 * attempt
            print(f"extract attempt {attempt} failed, retrying in {wait}s")
            time.sleep(wait)
    subprocess.run(["pmtiles", "verify", str(partial)], check=True)
    os.replace(partial, dest)


def fetch_assets(commit: str, out_dir: Path) -> None:
    """``fonts/`` and ``sprites/v4/`` from basemaps-assets at ``commit``,
    replacing whatever the directory had."""
    url = f"https://codeload.github.com/{ASSETS_REPO}/tar.gz/{commit}"
    with tempfile.TemporaryDirectory() as tmp:
        tarball = Path(tmp) / "assets.tar.gz"
        with requests.get(url, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            with tarball.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
        with tarfile.open(tarball) as tar:
            tar.extractall(tmp, filter="data")
        (root,) = [p for p in Path(tmp).iterdir() if p.is_dir()]
        for sub in ("fonts", "sprites/v4"):
            target = out_dir / sub
            if target.exists():
                shutil.rmtree(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(root / sub, target)


def build_basemap(
    out_dir: Path,
    build_key: str | None = None,
    bbox: tuple[float, float, float, float] = DEFAULT_BBOX,
    maxzoom: int = DEFAULT_MAXZOOM,
    force: bool = False,
) -> Manifest:
    out_dir.mkdir(parents=True, exist_ok=True)
    build = pick_build(fetch_builds(), build_key)
    archive = out_dir / ARCHIVE_NAME
    existing = read_manifest(out_dir)

    if force or needs_extract(existing, archive, build, bbox, maxzoom):
        print(
            f"extracting {build.key} (planet {build.size / 1e9:.0f}GB), bbox {bbox}, z0-{maxzoom}"
        )
        extract(build, bbox, maxzoom, archive)
    else:
        print(f"{archive} already holds {build.key} for this bbox/maxzoom, skipping extract")

    commit = latest_assets_commit()
    if (
        force
        or existing is None
        or existing.assets_commit != commit
        or not (out_dir / "fonts").exists()
    ):
        print(f"fetching fonts + sprites from {ASSETS_REPO}@{commit[:7]}")
        fetch_assets(commit, out_dir)

    manifest = Manifest(
        build=build.key,
        build_b3sum=build.b3sum,
        tileset_version=build.version,
        bbox=bbox,
        maxzoom=maxzoom,
        assets_commit=commit,
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    (out_dir / MANIFEST_NAME).write_text(json.dumps(asdict(manifest), indent=2) + "\n")
    return manifest


def upload(out_dir: Path, s3_prefix: str, profile: str | None) -> None:
    """Sync ``out_dir`` to ``s3_prefix`` (e.g. ``s3://<DataBucketName>/tiles/basemap``).

    ``aws s3 sync`` compares size and mtime, so an unchanged 20GB archive
    isn't re-uploaded. The fonts' ``.pbf`` extension isn't in the CLI's
    MIME table; MapLibre doesn't care about their content type.
    """
    cmd = [
        "aws",
        "s3",
        "sync",
        str(out_dir),
        s3_prefix.rstrip("/"),
        "--exclude",
        "*.partial",
        "--exclude",
        ".DS_Store",
    ]
    if profile:
        cmd += ["--profile", profile]
    subprocess.run(cmd, check=True)
