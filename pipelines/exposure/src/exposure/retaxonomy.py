"""Re-derive every exposure part's vulnerability class from its buildings
part, without re-crawling.

The region crawl resumes by skipping municipalities whose parts already
exist (region.py), so a change to `taxonomy.assign_taxonomy` never reaches
parts crawled before it. This applies the current rules to every part whose
`taxonomy_source` isn't `TAXONOMY_SOURCE`, from the `construction_year` and
`floors` already in its `<code>.buildings.parquet`, then recombines
exposure.parquet. CLI: retaxonomy_cli.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

from .region import combine_exposure
from .taxonomy import TAXONOMY_SOURCE, assign_taxonomy


def exposure_from_buildings(buildings: pd.DataFrame) -> pd.DataFrame:
    """The exposure part for these buildings, in pipeline.py's shape."""
    taxonomy = [
        assign_taxonomy(year, floors)
        for year, floors in zip(buildings["construction_year"], buildings["floors"])
    ]
    return pd.DataFrame(
        {
            "building_id": buildings["building_id"],
            "taxonomy_class": [t[0] for t in taxonomy],
            "height_class": [t[1] for t in taxonomy],
            "taxonomy_source": TAXONOMY_SOURCE,
        }
    )


def is_current(exposure_part: Path) -> bool:
    sources = pd.read_parquet(exposure_part, columns=["taxonomy_source"])["taxonomy_source"]
    return bool(len(sources)) and bool((sources == TAXONOMY_SOURCE).all())


def retaxonomy_parts(parts_dir: str | Path, force: bool = False) -> tuple[int, int]:
    """Rewrite every stale `<code>.exposure.parquet` in `parts_dir` (all of
    them with `force`). Each part is written to a temporary file and renamed
    over the old one, so an interrupted run leaves no half-written part and
    can simply be re-run. Returns (parts rewritten, buildings in them)."""
    parts_dir = Path(parts_dir)
    n_parts = n_buildings = 0
    for buildings_part in sorted(parts_dir.glob("*.buildings.parquet")):
        code = buildings_part.name.removesuffix(".buildings.parquet")
        exposure_part = parts_dir / f"{code}.exposure.parquet"
        if not force and exposure_part.exists() and is_current(exposure_part):
            continue
        buildings = pd.read_parquet(
            buildings_part, columns=["building_id", "construction_year", "floors"]
        )
        tmp = exposure_part.with_suffix(".parquet.tmp")
        exposure_from_buildings(buildings).to_parquet(tmp, index=False)
        os.replace(tmp, exposure_part)
        n_parts += 1
        n_buildings += len(buildings)
    return n_parts, n_buildings


def retaxonomy(
    parts_dir: str | Path, exposure_output: str | Path, force: bool = False
) -> tuple[int, int]:
    """`retaxonomy_parts`, then recombine exposure.parquet (atomically)."""
    counts = retaxonomy_parts(parts_dir, force=force)
    exposure_output = Path(exposure_output)
    tmp = exposure_output.with_suffix(".parquet.tmp")
    combine_exposure(parts_dir, tmp)
    os.replace(tmp, exposure_output)
    return counts
