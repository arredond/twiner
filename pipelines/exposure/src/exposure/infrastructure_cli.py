"""CLI: critical infrastructure from BTN (infrastructure.py, ADR-0025).

    uv run python -m exposure.infrastructure_cli data/infrastructure/raw \\
        data/exposure/parts data/exposure/municipalities.parquet data/infrastructure

`raw_dir` must already hold the three BTN theme GeoPackages (manual
download, see infrastructure.py). Writes into `out_dir`:

- `infrastructure.parquet` -- every asset with its geometry
- `infrastructure_sites.parquet` -- the same without geometry, what the
  scenario service loads
- `vs30_sites.parquet` -- ESRM20's Vs30 grid, for the intensity bands
- `infrastructure.pmtiles` -- the map layer (skipped with --skip-tiles)
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from . import vs30 as vs30_mod
from .infrastructure import SITE_COLUMNS, build_assets_table, tile_assets, write_vs30_sites


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw_dir")
    parser.add_argument("parts_dir")
    parser.add_argument("municipalities_parquet")
    parser.add_argument("out_dir")
    parser.add_argument("--skip-tiles", action="store_true")
    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.monotonic()
    grid = vs30_mod.fetch_spain_vs30_grid()
    assets = build_assets_table(
        args.raw_dir,
        args.municipalities_parquet,
        f"{args.parts_dir}/*.buildings.parquet",
        grid,
    )
    print(f"{len(assets):,} assets in {time.monotonic() - t0:.0f}s")
    print(assets.groupby(["category", "subtype"]).size().to_string())
    facilities = assets[assets["category"].isin(["health", "care", "education", "emergency"])]
    print(
        f"facilities matched to a building: {facilities['building_id'].notna().sum():,} "
        f"of {len(facilities):,} "
        f"({facilities['match'].value_counts().to_dict()})"
    )
    print(
        f"no municipality: {assets['municipality_code'].isna().sum():,}; "
        f"no vs30: {assets['vs30'].isna().sum():,}"
    )

    assets.to_parquet(out_dir / "infrastructure.parquet", index=False)
    assets[SITE_COLUMNS].to_parquet(out_dir / "infrastructure_sites.parquet", index=False)
    write_vs30_sites(grid, out_dir / "vs30_sites.parquet")

    if not args.skip_tiles:
        t0 = time.monotonic()
        tile_assets(assets, out_dir / "infrastructure.pmtiles")
        print(f"tiles in {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
