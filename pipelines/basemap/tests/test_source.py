from pathlib import Path

import pytest
from basemap.source import DEFAULT_BBOX, Build, Manifest, needs_extract, pick_build


def build(key: str) -> Build:
    return Build(key=key, size=1, b3sum="x", version="4.15.2")


BUILDS = [build("20260928.pmtiles"), build("20260930.pmtiles"), build("20260929.pmtiles")]


def test_pick_build_defaults_to_latest():
    assert pick_build(BUILDS).key == "20260930.pmtiles"


def test_pick_build_by_date_with_or_without_extension():
    assert pick_build(BUILDS, "20260929").key == "20260929.pmtiles"
    assert pick_build(BUILDS, "20260928.pmtiles").key == "20260928.pmtiles"


def test_pick_build_unknown_date():
    with pytest.raises(ValueError, match="not found"):
        pick_build(BUILDS, "20250101")


def manifest(key: str = "20260930.pmtiles", maxzoom: int = 15) -> Manifest:
    return Manifest(
        build=key,
        build_b3sum="x",
        tileset_version="4.15.2",
        bbox=DEFAULT_BBOX,
        maxzoom=maxzoom,
        assets_commit="abc",
        created_at="2026-09-30T00:00:00+00:00",
    )


def test_needs_extract_skips_when_inputs_match(tmp_path: Path):
    archive = tmp_path / "protomaps.pmtiles"
    archive.write_bytes(b"")
    assert not needs_extract(manifest(), archive, build("20260930.pmtiles"), DEFAULT_BBOX, 15)


def test_needs_extract_on_new_build_bbox_or_maxzoom(tmp_path: Path):
    archive = tmp_path / "protomaps.pmtiles"
    archive.write_bytes(b"")
    latest = build("20260930.pmtiles")
    assert needs_extract(manifest("20260929.pmtiles"), archive, latest, DEFAULT_BBOX, 15)
    assert needs_extract(manifest(), archive, latest, (-10.0, 35.0, 5.0, 44.0), 15)
    assert needs_extract(manifest(maxzoom=14), archive, latest, DEFAULT_BBOX, 15)


def test_needs_extract_when_archive_or_manifest_missing(tmp_path: Path):
    archive = tmp_path / "protomaps.pmtiles"
    latest = build("20260930.pmtiles")
    assert needs_extract(manifest(), archive, latest, DEFAULT_BBOX, 15)
    archive.write_bytes(b"")
    assert needs_extract(None, archive, latest, DEFAULT_BBOX, 15)
