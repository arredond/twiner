"""Flood-zone polygons, cleaned and cut by INE census section (ADR-0029).

Each source shapefile (sources.py) has a few thousand polygons per return
period, but traced from a 2m LiDAR terrain model: T=10 alone is 94M vertices,
and 13% of its polygons are invalid (self-intersections). So each polygon is:

1. repaired (`make_valid`), in its own projected CRS;
2. simplified with a 1m tolerance (Douglas-Peucker, then repaired again),
   which keeps ~15% of the vertices. 1m is half the terrain model's grid,
   and well under what the 1:25,000 maps claim to resolve;
3. reprojected to EPSG:4326, like every other layer here;
4. cut by census section, then all pieces of the same return period in the
   same section are merged into one (multi)polygon.

Why sections and not municipalities: a section nests inside exactly one
municipality (its code's first 5 digits), so anything keyed by section rolls
up to municipality, province and CCAA by code prefix. At ~36.5k sections vs
~8.1k municipalities, pieces are also smaller, which keeps a building's
intersection test cheap. The merge also removes overlaps between zones of
the same return period (different studies on the same river stretch), so
the map's translucent fill doesn't double up and areas aren't double
counted.

The cutting runs in parallel over chunks of each shapefile's features; the
merge runs in parallel over sections.
"""

from __future__ import annotations

import multiprocessing as mp
import time
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
from pyproj import Transformer

from .sources import SOURCES, extract

SIMPLIFY_TOLERANCE_M = 1.0
CHUNK_FEATURES = 100
# Equal-area CRS for reported areas (ETRS89 / LAEA Europe). Equal-area
# everywhere, Canarias included; only shapes are distorted far from its centre.
AREA_EPSG = 3035
MAX_RIVER_NAMES = 5
ZONES_ROW_GROUP_SIZE = 500

_POLYGON, _MULTIPOLYGON, _COLLECTION = 3, 6, 7


def polygonal(geoms: np.ndarray) -> np.ndarray:
    """Only the polygonal part of each geometry (None if it has none).

    `make_valid` and intersections can return GeometryCollections mixing in
    zero-area lines/points along shared edges."""
    geoms = np.asarray(geoms, dtype=object)
    out = geoms.copy()
    types = shapely.get_type_id(geoms)
    out[(types != _POLYGON) & (types != _MULTIPOLYGON) & (types != _COLLECTION)] = None
    for i in np.flatnonzero(types == _COLLECTION):
        parts = shapely.get_parts(geoms[i])
        parts = parts[np.isin(shapely.get_type_id(parts), (_POLYGON, _MULTIPOLYGON))]
        out[i] = shapely.union_all(parts) if len(parts) else None
    empty = np.array([g is None or shapely.is_empty(g) for g in out])
    out[empty] = None
    return out


def to_crs(geoms: np.ndarray, src_epsg: int, dst_epsg: int) -> np.ndarray:
    transformer = Transformer.from_crs(src_epsg, dst_epsg, always_xy=True)

    def fn(xy: np.ndarray) -> np.ndarray:
        x, y = transformer.transform(xy[:, 0], xy[:, 1])
        return np.column_stack([x, y])

    return shapely.transform(geoms, fn)


def clean(geoms: np.ndarray, epsg: int) -> np.ndarray:
    """Steps 1-3 of the module docstring: repair, simplify, reproject."""
    geoms = polygonal(shapely.make_valid(geoms))
    keep = np.array([g is not None for g in geoms])
    # Plain Douglas-Peucker, then repair: the topology-preserving variant
    # is quadratic-ish in rings, and these zones have 1M+ vertices and
    # hundreds of holes (a single T=10 polygon took minutes; this takes
    # 0.2s, area within 0.02%).
    simplified = shapely.simplify(geoms[keep], SIMPLIFY_TOLERANCE_M, preserve_topology=False)
    geoms[keep] = polygonal(shapely.make_valid(simplified))
    keep = np.array([g is not None for g in geoms])
    # Reprojecting can nudge a valid polygon into a tiny self-intersection
    # (seen on T=500: a GEOS "side location conflict" in the section cut),
    # so repair once more; cheap now the geometry is simplified.
    geoms[keep] = polygonal(shapely.make_valid(to_crs(geoms[keep], epsg, 4326)))
    return geoms


# --- worker state: the section polygons, loaded once per worker process ----
_sections: np.ndarray | None = None
_section_codes: np.ndarray | None = None
_section_tree: shapely.STRtree | None = None


def _init_sections(sections_path: str) -> None:
    global _sections, _section_codes, _section_tree
    table = gpd.read_parquet(sections_path, columns=["code", "geometry"])
    _sections = polygonal(shapely.make_valid(table.geometry.values))
    _section_codes = table["code"].to_numpy()
    _section_tree = shapely.STRtree(_sections)


def cut_by_sections(
    geoms: np.ndarray, sections: np.ndarray, tree: shapely.STRtree
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(geometry index, section index, piece) for every non-empty
    intersection of `geoms` with `sections`."""
    gi, si = tree.query(geoms, predicate="intersects")
    # A zone entirely inside one section (common: sections are km-sized,
    # many zones are short urban stretches) needs no intersection at all.
    inside = shapely.contains_properly(sections[si], geoms[gi])
    pieces = np.empty(len(gi), dtype=object)
    pieces[inside] = geoms[gi[inside]]
    rest = ~inside
    if rest.any():
        try:
            pieces[rest] = polygonal(shapely.intersection(geoms[gi[rest]], sections[si[rest]]))
        except shapely.errors.GEOSException:
            # One bad pair fails the whole vectorized call: redo pair by
            # pair, snapping a failing one to a 1e-9 degree (~0.1mm) grid.
            for k in np.flatnonzero(rest):
                pieces[k] = _robust_intersection(geoms[gi[k]], sections[si[k]])
    keep = np.array([p is not None for p in pieces], dtype=bool)
    return gi[keep], si[keep], pieces[keep]


def _robust_intersection(a: shapely.Geometry, b: shapely.Geometry) -> shapely.Geometry | None:
    try:
        piece = shapely.intersection(a, b)
    except shapely.errors.GEOSException:
        piece = shapely.intersection(a, b, grid_size=1e-9)
    return polygonal(np.array([piece], dtype=object))[0]


def _process_chunk(args: tuple[str, int, int, int, int]) -> dict:
    shp, epsg, _return_period, offset, count = args
    assert _sections is not None and _section_codes is not None and _section_tree is not None
    df = pyogrio.read_dataframe(
        shp, skip_features=offset, max_features=count, columns=["ID_ZONA", "RIO"]
    )
    geoms = clean(np.asarray(df.geometry.values, dtype=object).copy(), epsg)
    valid = np.flatnonzero([g is not None for g in geoms])
    gi, si, pieces = cut_by_sections(geoms[valid], _sections, _section_tree)
    zone_rows = valid[gi]
    in_sections = shapely.area(to_crs(pieces, 4326, AREA_EPSG)).sum() if len(pieces) else 0.0
    total = shapely.area(to_crs(geoms[valid], 4326, AREA_EPSG)).sum() if len(valid) else 0.0
    return {
        "section_code": _section_codes[si],
        "zone_id": df["ID_ZONA"].to_numpy()[zone_rows],
        "river": df["RIO"].to_numpy()[zone_rows],
        "geometry": pieces,
        "n_features": len(df),
        "n_dropped": len(df) - len(valid),
        "area_outside_m2": float(total - in_sections),
    }


def _merge_section(
    args: tuple[str, list[shapely.Geometry], list[str], list[str]],
) -> tuple[str, shapely.Geometry | None, str, int]:
    code, pieces, rivers, zone_ids = args
    geom = pieces[0] if len(pieces) == 1 else shapely.union_all(np.array(pieces, dtype=object))
    geom = polygonal(np.array([shapely.make_valid(geom)], dtype=object))[0]
    names = sorted({r.strip() for r in rivers if isinstance(r, str) and r.strip()})
    river_label = "; ".join(names[:MAX_RIVER_NAMES]) + (
        "; …" if len(names) > MAX_RIVER_NAMES else ""
    )
    return code, geom, river_label, len(set(zone_ids))


def build_return_period(
    raw_dir: str | Path,
    return_period: int,
    sections_path: str | Path,
    workers: int | None = None,
) -> gpd.GeoDataFrame:
    """All sources for one return period, cleaned, cut by section and
    merged: one row per (section, return period) with any flood zone."""
    workers = workers or max(1, mp.cpu_count() - 2)
    tasks = []
    for source in [s for s in SOURCES if s.return_period == return_period]:
        shp = extract(raw_dir, source)
        info = pyogrio.read_info(shp)
        if info["crs"] != f"EPSG:{source.epsg}":
            raise ValueError(f"{shp}: CRS {info['crs']}, expected EPSG:{source.epsg}")
        tasks += [
            (str(shp), source.epsg, return_period, off, CHUNK_FEATURES)
            for off in range(0, info["features"], CHUNK_FEATURES)
        ]

    t0 = time.monotonic()
    by_section: dict[str, tuple[list, list, list]] = defaultdict(lambda: ([], [], []))
    n_features = n_dropped = 0
    area_outside = 0.0
    ctx = mp.get_context("spawn")
    with ctx.Pool(workers, initializer=_init_sections, initargs=(str(sections_path),)) as pool:
        for i, chunk in enumerate(pool.imap_unordered(_process_chunk, tasks), 1):
            n_features += chunk["n_features"]
            n_dropped += chunk["n_dropped"]
            area_outside += chunk["area_outside_m2"]
            for code, zone_id, river, geom in zip(
                chunk["section_code"], chunk["zone_id"], chunk["river"], chunk["geometry"]
            ):
                pieces, rivers, zone_ids = by_section[code]
                pieces.append(geom)
                rivers.append(river)
                zone_ids.append(zone_id)
            if i % 10 == 0 or i == len(tasks):
                print(
                    f"  T={return_period}: {i}/{len(tasks)} chunks, {time.monotonic() - t0:.0f}s",
                    flush=True,
                )
        print(
            f"  T={return_period}: {n_features} zones ({n_dropped} with no polygonal "
            f"geometry left), {len(by_section)} sections, "
            f"{area_outside / 1e6:.1f} km2 outside every section (sea, border)",
            flush=True,
        )
        merged = pool.map(
            _merge_section,
            [(code, p, r, z) for code, (p, r, z) in by_section.items()],
            chunksize=64,
        )

    merged = [m for m in merged if m[1] is not None]
    geoms = np.array([m[1] for m in merged], dtype=object)
    frame = gpd.GeoDataFrame(
        {
            "return_period": np.full(len(merged), return_period, dtype=np.int16),
            "section_code": [m[0] for m in merged],
            "municipality_code": [m[0][:5] for m in merged],
            "rivers": [m[2] for m in merged],
            "n_zones": np.array([m[3] for m in merged], dtype=np.int32),
            "area_m2": shapely.area(to_crs(geoms, 4326, AREA_EPSG)) if len(geoms) else [],
        },
        geometry=geoms,
        crs="EPSG:4326",
    )
    bounds = shapely.bounds(geoms) if len(geoms) else np.zeros((0, 4))
    for i, name in enumerate(("bbox_xmin", "bbox_ymin", "bbox_xmax", "bbox_ymax")):
        frame[name] = bounds[:, i]
    print(f"  T={return_period}: merged in {time.monotonic() - t0:.0f}s total", flush=True)
    return frame.sort_values("section_code", ignore_index=True)


def build_zones(
    raw_dir: str | Path,
    sections_path: str | Path,
    work_dir: str | Path,
    output: str | Path,
    workers: int | None = None,
    return_periods: tuple[int, ...] | None = None,
) -> gpd.GeoDataFrame:
    """Every return period (each cached as `work_dir/zones_T<rp>.parquet`,
    so a failed run resumes), combined into `output`."""
    from .sources import RETURN_PERIODS

    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for rp in return_periods or RETURN_PERIODS:
        path = work_dir / f"zones_T{rp}.parquet"
        if not path.exists():
            build_return_period(raw_dir, rp, sections_path, workers).to_parquet(path)
        frames.append(gpd.read_parquet(path))
    zones = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")
    # Small row groups, in section-code (so province) order: a worker
    # flagging one province's buildings (exposure.py) reads only the row
    # groups whose bbox statistics overlap it. One row group of all ~38k
    # pieces made each of 8 workers decode the whole ~0.9GB geometry
    # column, which ran a 16GB machine out of memory.
    zones.sort_values(["section_code", "return_period"]).to_parquet(
        output, row_group_size=ZONES_ROW_GROUP_SIZE
    )
    return zones
