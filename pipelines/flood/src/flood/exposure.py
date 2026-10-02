"""Which buildings and critical-infrastructure assets lie in a flood zone,
per return period (ADR-0029).

A building counts as flooded at return period T when its **footprint
intersects** T's flood zone, not just its centroid: a long building along a
river bank can have its centroid on dry ground and a wall in the water. The
footprints come from the exposure pipeline's per-municipality
`<code>.buildings.parquet` parts, the zones from zones.py.

Output, `building_flood.parquet`: only the buildings flooded at *some*
return period (most of Spain's 13M buildings aren't in any mapped zone), one
nullable boolean per return period: True/False where that return period
is mapped, NULL where it isn't (Canarias has no fluvial T=10/T=50 map,
sources.py; the coastal maps cover everywhere). A building absent from the file is in no mapped zone. The
columns the scenario service reads ride along from
`buildings-cloud-impact.parquet` (centroid, municipality, census section,
dwellings, built area), so a flood scenario reads this one small file only.

The work is split by province: each worker loads only the zone pieces
overlapping its province's bounding box, then tests one municipality's
footprints at a time against them, skipping municipalities whose bounding
box touches no zone at all. Each province is cached under `work_dir` so a
failed run resumes.
"""

from __future__ import annotations

import multiprocessing as mp
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.dataset as ds
import pyarrow.parquet as pq
import shapely

from .sources import FLUVIAL, HAZARDS, Hazard

PARTS_SUFFIX = ".buildings.parquet"
# Catastro files Ceuta/Melilla under its own office codes 55/56, not INE
# provinces 51/52 (see scenario.impact's _CATASTRO_CODE_TO_INE).
_CATASTRO_PROVINCE_TO_INE = {"55": "51", "56": "52"}


def province_of_part(path: Path) -> str:
    code = path.name.split(".", 1)[0][:2]
    return _CATASTRO_PROVINCE_TO_INE.get(code, code)


def part_bbox(path: Path) -> tuple[float, float, float, float] | None:
    """A part's bounding box from its row-group statistics alone (no data
    read). None for an empty part."""
    meta = pq.ParquetFile(path).metadata
    names = meta.schema.names
    idx = {n: names.index(n) for n in ("bbox_xmin", "bbox_ymin", "bbox_xmax", "bbox_ymax")}
    box = [np.inf, np.inf, -np.inf, -np.inf]
    for rg in range(meta.num_row_groups):
        stats = {n: meta.row_group(rg).column(i).statistics for n, i in idx.items()}
        if any(s is None or not s.has_min_max for s in stats.values()):
            continue
        box[0] = min(box[0], stats["bbox_xmin"].min)
        box[1] = min(box[1], stats["bbox_ymin"].min)
        box[2] = max(box[2], stats["bbox_xmax"].max)
        box[3] = max(box[3], stats["bbox_ymax"].max)
    return None if box[0] == np.inf else (box[0], box[1], box[2], box[3])


def load_zone_trees(
    zones_path: str | Path,
    box: tuple[float, float, float, float] | None = None,
    return_periods: tuple[int, ...] = FLUVIAL.return_periods,
) -> dict[int, shapely.STRtree]:
    """One STRtree of zone pieces per return period, optionally only the
    pieces whose bounding box overlaps `box`."""
    dataset = ds.dataset(str(zones_path), format="parquet")
    filt = None
    if box is not None:
        xmin, ymin, xmax, ymax = box
        filt = (
            (ds.field("bbox_xmax") >= xmin)
            & (ds.field("bbox_xmin") <= xmax)
            & (ds.field("bbox_ymax") >= ymin)
            & (ds.field("bbox_ymin") <= ymax)
        )
    table = dataset.to_table(columns=["return_period", "geometry"], filter=filt)
    rps = table.column("return_period").to_numpy()
    geoms = shapely.from_wkb(table.column("geometry").to_numpy(zero_copy_only=False))
    return {rp: shapely.STRtree(geoms[rps == rp]) for rp in return_periods}


def intersects_any(geoms: np.ndarray, tree: shapely.STRtree) -> np.ndarray:
    """Boolean mask: which of `geoms` intersect any geometry in `tree`.

    The zone pieces go in as the query input, against a tree of `geoms`:
    GEOS prepares each query geometry once, so every big zone polygon is
    prepared once and then tested cheaply against the small footprints
    near it. The other way round (footprints querying a tree of zones)
    re-evaluated each big polygon unprepared for every footprint: Murcia,
    with its huge rural sections on the Segura plain, took 17+ minutes
    that way."""
    hit = np.zeros(len(geoms), dtype=bool)
    zones = tree.geometries
    if len(zones) and len(geoms):
        _, idx = shapely.STRtree(geoms).query(zones, predicate="intersects")
        hit[idx] = True
    return hit


def flags_table(
    ids: pa.Array,
    hits: dict[int, np.ndarray],
    province: str,
    part_code: str = "",
    hazard: Hazard = FLUVIAL,
) -> pa.Table:
    """One nullable boolean column per return period, for the rows flooded
    at some mapped return period. NULL for return periods not mapped in
    this province."""
    mapped = hazard.mapped_return_periods(province)
    any_hit = np.zeros(len(ids), dtype=bool)
    for rp in mapped:
        any_hit |= hits[rp]
    rows = np.flatnonzero(any_hit)
    # `part_code` (the part file's municipality code) disambiguates the
    # ~1.7k building ids Catastro repeats across municipalities
    # (DATA-SOURCES.md, "non-unique building_id") in the final join.
    columns = {
        "building_id": ids.take(pa.array(rows)),
        "part_code": pa.array([part_code] * len(rows), pa.string()),
    }
    for rp, name in zip(hazard.return_periods, hazard.flag_columns):
        values = hits[rp][rows]
        mask = None if rp in mapped else np.ones(len(rows), dtype=bool)
        columns[name] = pa.array(values, type=pa.bool_(), mask=mask)
    return pa.table(columns)


def _flag_province(
    args: tuple[str, list[str], str, str, str],
) -> tuple[str, int, int, int, float]:
    province, part_paths, zones_path, out_path, hazard_key = args
    hazard = HAZARDS[hazard_key]
    t0 = time.monotonic()
    boxes = {p: part_bbox(Path(p)) for p in part_paths}
    boxes = {p: b for p, b in boxes.items() if b is not None}
    if not boxes:
        pq.write_table(_empty_flags(hazard), out_path)
        return province, 0, 0, 0, 0.0
    arr = np.array(list(boxes.values()))
    province_box = (arr[:, 0].min(), arr[:, 1].min(), arr[:, 2].max(), arr[:, 3].max())
    trees = load_zone_trees(zones_path, province_box, hazard.return_periods)
    all_trees = [t for t in trees.values() if len(t.geometries)]

    tables = []
    n_parts = n_buildings = 0
    for path, box in boxes.items():
        # Skip a municipality whose bounding box touches no zone at all.
        part_box = shapely.box(*box)
        if not any(len(t.query(part_box)) for t in all_trees):
            continue
        n_parts += 1
        table = pq.read_table(path, columns=["building_id", "geometry"])
        n_buildings += table.num_rows
        geoms = shapely.from_wkb(table.column("geometry").to_numpy(zero_copy_only=False))
        hits = {rp: intersects_any(geoms, trees[rp]) for rp in hazard.return_periods}
        part_code = Path(path).name.split(".", 1)[0]
        ids = table.column("building_id").combine_chunks()
        tables.append(flags_table(ids, hits, province, part_code, hazard))
    result = pa.concat_tables(tables) if tables else _empty_flags(hazard)
    pq.write_table(result, out_path)
    return province, n_parts, n_buildings, result.num_rows, time.monotonic() - t0


def _empty_flags(hazard: Hazard) -> pa.Table:
    return pa.table(
        {
            "building_id": pa.array([], pa.string()),
            "part_code": pa.array([], pa.string()),
            **{c: pa.array([], pa.bool_()) for c in hazard.flag_columns},
        }
    )


def flag_buildings(
    zones_path: str | Path,
    parts_dir: str | Path,
    work_dir: str | Path,
    workers: int | None = None,
    hazard: Hazard = FLUVIAL,
) -> list[Path]:
    """Per-province flag tables under `work_dir/flags/` (existing ones are
    kept). Returns their paths."""
    out_dir = Path(work_dir) / "flags"
    out_dir.mkdir(parents=True, exist_ok=True)
    by_province: dict[str, list[str]] = defaultdict(list)
    for path in sorted(Path(parts_dir).glob(f"*{PARTS_SUFFIX}")):
        by_province[province_of_part(path)].append(str(path))
    tasks = []
    outputs = []
    for province, paths in sorted(by_province.items()):
        out = out_dir / f"{province}.parquet"
        outputs.append(out)
        if not out.exists():
            tasks.append((province, paths, str(zones_path), str(out), hazard.key))
    print(f"flagging buildings: {len(tasks)} of {len(by_province)} provinces to do", flush=True)
    ctx = mp.get_context("spawn")
    with ctx.Pool(workers or max(1, mp.cpu_count() - 2)) as pool:
        for province, n_parts, n_buildings, n_flooded, secs in pool.imap_unordered(
            _flag_province, tasks
        ):
            print(
                f"  {province}: {n_flooded:,} flooded of {n_buildings:,} buildings tested "
                f"in {n_parts} municipalities, {secs:.0f}s",
                flush=True,
            )
    return outputs


def write_building_flood(
    flag_paths: list[Path],
    cloud_impact_path: str | Path,
    output: str | Path,
    hazard: Hazard = FLUVIAL,
) -> int:
    """Join the flags onto the scenario service's per-building columns and
    write `building_flood.parquet`, sorted by census section so area
    selections read contiguous rows. Returns the row count."""
    import duckdb

    con = duckdb.connect()
    flags = ", ".join(f"f.{c}" for c in hazard.flag_columns)
    # Interpolated, not bound: DuckDB's COPY takes no parameter for the
    # target. Both paths are local CLI arguments, never web input.
    con.execute(
        f"""
        COPY (
            SELECT b.building_id, b.centroid_lon, b.centroid_lat, b.municipality_code,
                   b.census_section_code, b.num_dwellings, b.built_area_m2, {flags}
            FROM read_parquet(?) AS f
            JOIN read_parquet(?) AS b
              ON b.building_id = f.building_id AND b.municipality_code = f.part_code
            ORDER BY b.census_section_code, b.building_id
        ) TO '{output}' (FORMAT PARQUET, ROW_GROUP_SIZE 50000, COMPRESSION ZSTD)
        """,
        [[str(p) for p in flag_paths], str(cloud_impact_path)],
    )
    row = con.execute("SELECT COUNT(*) FROM read_parquet(?)", [str(output)]).fetchone()
    assert row is not None
    return row[0]


def flag_infrastructure(
    zones_path: str | Path,
    infrastructure_path: str | Path,
    output: str | Path,
    hazard: Hazard = FLUVIAL,
) -> pa.Table:
    """Critical-infrastructure assets (ADR-0025) in a flood zone: the same
    intersection test on each asset's own geometry (point, line or
    polygon), same NULL convention as the buildings. Assets are few
    (~214k), so this runs in one process against the national zones."""
    table = pq.read_table(
        infrastructure_path,
        columns=[
            "asset_id",
            "category",
            "subtype",
            "name",
            "lon",
            "lat",
            "municipality_code",
            "geometry",
        ],
    )
    geoms = shapely.from_wkb(table.column("geometry").to_numpy(zero_copy_only=False))
    trees = load_zone_trees(zones_path, return_periods=hazard.return_periods)
    hits = {rp: intersects_any(geoms, trees[rp]) for rp in hazard.return_periods}
    provinces = np.array(
        [str(m)[:2] if m else "" for m in table.column("municipality_code").to_pylist()]
    )
    any_hit = np.zeros(len(geoms), dtype=bool)
    for rp in hazard.return_periods:
        any_hit |= hits[rp]
    rows = np.flatnonzero(any_hit)
    result = table.drop(["geometry"]).take(pa.array(rows))
    for rp, name in zip(hazard.return_periods, hazard.flag_columns):
        unmapped = np.array(
            [rp not in hazard.mapped_return_periods(p) for p in provinces[rows]], dtype=bool
        )
        result = result.append_column(
            name, pa.array(hits[rp][rows], type=pa.bool_(), mask=unmapped)
        )
    pq.write_table(result, output)
    return result
