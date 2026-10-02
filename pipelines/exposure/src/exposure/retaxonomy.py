"""Re-derive every exposure part's vulnerability classes from its
buildings part, without re-crawling.

The region crawl resumes by skipping municipalities whose parts already
exist (region.py), so a change to a classification scheme
(classification.py) never reaches parts crawled before it. This applies
the current schemes to every part where any scheme's version column is
missing or out of date, from the attributes already in its
`<code>.buildings.parquet`, then recombines exposure.parquet. CLI:
retaxonomy_cli.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

from .classification import classify
from .classification import is_current as _classes_current
from .region import combine_exposure


def exposure_from_buildings(buildings: pd.DataFrame) -> pd.DataFrame:
    """The exposure part for these buildings, in pipeline.py's shape."""
    return classify(buildings)


def is_current(exposure_part: Path) -> bool:
    return _classes_current(pd.read_parquet(exposure_part))


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
            buildings_part,
            columns=["building_id", "construction_year", "floors", "municipality_code"],
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
