"""CLI: MITECO flood zones -> tiles + per-building and per-asset flood
exposure (ADR-0029).

    uv run python -m flood data/flood/raw data/exposure/parts \\
        data/exposure/buildings-cloud-impact.parquet data/census/sections.parquet \\
        data/infrastructure/infrastructure.parquet data/flood

The raw zips are a manual download (sources.py); a missing one stops the
run with the URLs to fetch. Writes into `out_dir`, each step skipped when
its output already exists (`--force` redoes everything):

1. `zones.parquet` -- flood zones cut by census section, one row per
   (section, return period); `zone_areas.parquet` is the same without
   geometry (what the scenario service loads)
2. `building_flood.parquet` -- flooded buildings, one flag per return period
3. `infrastructure_flood.parquet` -- the same for critical infrastructure
4. `flood_zones.pmtiles`, `flood_buildings.pmtiles`
"""

from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from . import exposure, sources, tiles, zones


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw_dir")
    parser.add_argument("parts_dir")
    parser.add_argument("cloud_impact_parquet")
    parser.add_argument("sections_parquet")
    parser.add_argument("infrastructure_parquet")
    parser.add_argument("out_dir")
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-tiles", action="store_true")
    args = parser.parse_args()

    missing = sources.check_raw(args.raw_dir)
    if missing:
        raise SystemExit(sources.missing_files_message(missing, args.raw_dir))

    out = Path(args.out_dir)
    work = out / "work"
    if args.force and work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)

    def todo(path: Path) -> bool:
        return args.force or not path.exists()

    zones_path = out / "zones.parquet"
    if todo(zones_path):
        t0 = time.monotonic()
        built = zones.build_zones(
            args.raw_dir, args.sections_parquet, work, zones_path, workers=args.workers
        )
        built.drop(columns="geometry").to_parquet(out / "zone_areas.parquet", index=False)
        summary = built.groupby("return_period").agg(
            sections=("section_code", "size"),
            municipalities=("municipality_code", "nunique"),
            km2=("area_m2", lambda a: round(a.sum() / 1e6, 1)),
        )
        print(f"zones: {time.monotonic() - t0:.0f}s\n{summary}", flush=True)

    buildings_path = out / "building_flood.parquet"
    if todo(buildings_path):
        t0 = time.monotonic()
        flag_paths = exposure.flag_buildings(zones_path, args.parts_dir, work, args.workers)
        n = exposure.write_building_flood(flag_paths, args.cloud_impact_parquet, buildings_path)
        print(f"building_flood.parquet: {n:,} buildings, {time.monotonic() - t0:.0f}s", flush=True)

    infra_path = out / "infrastructure_flood.parquet"
    if todo(infra_path):
        t0 = time.monotonic()
        table = exposure.flag_infrastructure(zones_path, args.infrastructure_parquet, infra_path)
        print(
            f"infrastructure_flood.parquet: {table.num_rows:,} assets, "
            f"{time.monotonic() - t0:.0f}s",
            flush=True,
        )

    if args.skip_tiles:
        return
    zones_tiles = out / "flood_zones.pmtiles"
    if todo(zones_tiles):
        t0 = time.monotonic()
        tiles.tile_zones(zones_path, zones_tiles)
        size = zones_tiles.stat().st_size / 1e6
        print(f"{zones_tiles}: {size:.0f}MB, {time.monotonic() - t0:.0f}s", flush=True)
    buildings_tiles = out / "flood_buildings.pmtiles"
    if todo(buildings_tiles):
        t0 = time.monotonic()
        tiles.tile_buildings(buildings_path, args.parts_dir, buildings_tiles)
        size = buildings_tiles.stat().st_size / 1e6
        print(f"{buildings_tiles}: {size:.0f}MB, {time.monotonic() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
