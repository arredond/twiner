"""CLI: census sections + population + per-building section assignment
(census_sections.py, ADR-0024).

    uv run python -m exposure.census_sections_cli <raw_dir> <parts_dir> <out_dir> \\
        <buildings-cloud-impact.parquet>

Writes, in order (each step resumable or cheap to redo):

1. `<parts_dir>/<code>.sites.parquet` sidecars (skips existing ones)
2. `<out_dir>/sections.parquet` -- boundaries + population + building totals
3. `<out_dir>/sections_meta.parquet` / `municipalities_meta.parquet` -- the
   same without geometry, what the scenario service loads
4. `<out_dir>/sections.pmtiles` -- the map's section choropleth geometry
5. the compacted sites file the scenario service queries (engine.py)
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from .census_sections import (
    SITES_SUFFIX,
    build_municipalities_table,
    build_sections_table,
    build_site_parts,
    compact_sites_for_cloud,
    download,
    load_population,
    load_sections,
    section_building_totals,
)
from .tile import tile_sections


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw_dir")
    parser.add_argument("parts_dir")
    parser.add_argument("out_dir")
    parser.add_argument("sites_output")
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--skip-tiles", action="store_true")
    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.monotonic()
    shp_path, csv_paths = download(args.raw_dir)
    sections = load_sections(shp_path)
    population = load_population(csv_paths)
    print(
        f"{len(sections)} sections, {len(population)} with population "
        f"({population['population'].sum():,} residents), {time.monotonic() - t0:.0f}s"
    )

    t0 = time.monotonic()
    results = build_site_parts(args.parts_dir, sections, max_workers=args.workers)
    failed = [r for r in results if r[2]]
    print(
        f"built {len(results) - len(failed)} site parts "
        f"({sum(r[1] for r in results):,} buildings), {len(failed)} failed, "
        f"{time.monotonic() - t0:.0f}s"
    )
    if failed:
        raise SystemExit("some site parts failed -- fix and re-run (finished parts are kept)")

    totals = section_building_totals(str(Path(args.parts_dir) / f"*{SITES_SUFFIX}"))
    table = build_sections_table(sections, population, totals)
    table.to_parquet(out_dir / "sections.parquet")
    table.drop(columns="geometry").to_parquet(out_dir / "sections_meta.parquet", index=False)
    municipalities = build_municipalities_table(table)
    municipalities.to_parquet(out_dir / "municipalities_meta.parquet", index=False)
    no_buildings = table[(table["population"] > 0) & (table["n_dwellings"] == 0)]
    print(
        f"wrote sections tables; {len(no_buildings)} populated sections have no "
        f"dwellings among their buildings ({no_buildings['population'].sum():,} residents)"
    )

    if not args.skip_tiles:
        t0 = time.monotonic()
        tile_sections(table, out_dir / "sections.pmtiles")
        print(f"wrote {out_dir / 'sections.pmtiles'} in {time.monotonic() - t0:.0f}s")

    t0 = time.monotonic()
    n = compact_sites_for_cloud(args.parts_dir, args.sites_output)
    print(f"wrote {n:,} buildings to {args.sites_output} in {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
