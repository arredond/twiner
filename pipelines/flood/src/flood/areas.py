"""Which admin areas a hazard's maps cover at all (ADR-0037).

Coastal flood zones touch ~400 of Spain's ~8.1k municipalities, so the
twinCOAST area picker and search box only list the areas that have a zone:
Madrid is never a useful coastal answer. The index is derived from the
pipeline's own output, not a hand-kept list of coastal provinces, so an
estuary municipality inland (Sevilla, on the Guadalquivir) is in it and a
coastal one with no studied stretch isn't.

`<prefix>_areas.json`: `{"municipality": [code, ...], "province": [code,
...]}`, sorted INE codes. CCAA aren't listed: the frontend maps each
province to its CCAA through the admin index (`admin_index.json`), which
already has that link.

A municipality counts when a zone covers at least `MIN_AREA_M2` of it at
some return period, or when any of its buildings is flagged. The area
threshold drops slivers where a zone drawn along one municipality's coast
grazes its neighbour's census-section edge, which would otherwise list a
municipality with nothing to show.
"""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow.parquet as pq

MIN_AREA_M2 = 1_000.0


def covered_municipalities(
    zone_areas_path: str | Path, building_flood_path: str | Path
) -> list[str]:
    zones = pq.read_table(zone_areas_path, columns=["municipality_code", "area_m2"]).to_pydict()
    codes = {
        code
        for code, area in zip(zones["municipality_code"], zones["area_m2"])
        if code and area >= MIN_AREA_M2
    }
    buildings = pq.read_table(building_flood_path, columns=["census_section_code"])
    codes |= {s[:5] for s in buildings.column("census_section_code").to_pylist() if s}
    return sorted(codes)


def write_areas(
    zone_areas_path: str | Path, building_flood_path: str | Path, output: str | Path
) -> dict[str, list[str]]:
    munis = covered_municipalities(zone_areas_path, building_flood_path)
    index = {"municipality": munis, "province": sorted({m[:2] for m in munis})}
    Path(output).write_text(json.dumps(index, separators=(",", ":")))
    return index
