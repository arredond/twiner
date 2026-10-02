"""Flood scenarios: which buildings, people and critical infrastructure lie
in MITECO's flood zone for a return period, inside a circle or an admin area.

Two hazards share this module, each with its own pipeline outputs
(`FloodHazard`): fluvial (twinFLOOD, ADR-0029, `POST /scenarios/flood`)
and coastal (twinCOAST, ADR-0037, `POST /scenarios/coast`). Both are
"polygon zone per return period -> flagged buildings"; only the return
periods, the data directory and which provinces are unmapped differ.

No physics runs per request. The flood pipeline (pipelines/flood) has
already intersected every building footprint with every return period's
zones, so a scenario is a filter over precomputed flags plus sums:

- `building_flood.parquet` lists only the buildings flooded at some return
  period (~662k, about 5% of Spain's 13M). It's loaded into memory once per process,
  and a request filters it with numpy: a bounding-box prefilter then exact
  distance for a circle, a code-prefix match for an admin area. So even a
  circle covering a whole region never scans the full 13M-building
  exposure: the big file is only read for the buildings that matter.
- Percentages use each census section's static totals (buildings,
  dwellings, population: pipelines/exposure census_sections.py) as
  denominators, the same as the seismic impact estimates (impact.py).
  Residents are spread over a section's buildings in proportion to their
  dwellings, so affected residents = population x flooded dwellings /
  all dwellings.
- Flooded area comes from `zone_areas.parquet` (km2 per section and return
  period). For a circle, sections cut by its edge have their zone pieces
  intersected with it (`zones.parquet` geometry, read only for those).

Seismic cost/debris/shoring estimates don't apply: they're earthquake
damage ratios. A flood loss estimate would need water depth, which these
maps don't have (ADR-0029, "Not done").
"""

from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass
from typing import Literal

import numpy as np
import pyarrow as pa

from .impact import AreaMeta, area_meta

FLOOD_DIR = os.environ.get("TWINER_FLOOD_DIR", "data/flood")
COAST_DIR = os.environ.get("TWINER_COAST_DIR", "data/coast")

# Provinces without a fluvial T=10/T=50 map (sources.py in pipelines/flood).
CANARIAS_PROVINCES = ("35", "38")

_KM_PER_DEG_LAT = 111.32
_EARTH_RADIUS_KM = 6371.0088
MAX_RADIUS_KM = 200.0

# INE CCAA -> provinces. Kept in sync by hand with pipelines/exposure's
# admin_areas.py (the frontend's area picker reads that module's index).
CCAA_PROVINCES: dict[str, tuple[str, ...]] = {
    "01": ("04", "11", "14", "18", "21", "23", "29", "41"),
    "02": ("22", "44", "50"),
    "03": ("33",),
    "04": ("07",),
    "05": ("35", "38"),
    "06": ("39",),
    "07": ("05", "09", "24", "34", "37", "40", "42", "47", "49"),
    "08": ("02", "13", "16", "19", "45"),
    "09": ("08", "17", "25", "43"),
    "10": ("03", "12", "46"),
    "11": ("06", "10"),
    "12": ("15", "27", "32", "36"),
    "13": ("28",),
    "14": ("30",),
    "15": ("31",),
    "16": ("01", "20", "48"),
    "17": ("26",),
    "18": ("51",),
    "19": ("52",),
}
_PROVINCES = {p for ps in CCAA_PROVINCES.values() for p in ps}

AdminLevel = Literal["ccaa", "province", "municipality"]


@dataclass(frozen=True)
class FloodHazard:
    """One flood hazard's request rules and data location."""

    key: Literal["flood", "coast"]  # the response's `hazard`, the id's `mode`
    # Name of the module global holding the data directory (FLOOD_DIR /
    # COAST_DIR), looked up on use so tests can point it elsewhere.
    dir_name: str
    return_periods: tuple[int, ...]
    # Return period -> provinces with no map for it ("not mapped", not "dry").
    unmapped: dict[int, tuple[str, ...]]

    @property
    def data_dir(self) -> str:
        return globals()[self.dir_name]


FLUVIAL = FloodHazard(
    key="flood",
    dir_name="FLOOD_DIR",
    return_periods=(10, 50, 100, 500),
    unmapped={10: CANARIAS_PROVINCES, 50: CANARIAS_PROVINCES},
)
# One file per return period covers all of Spain, Canarias, Ceuta and
# Melilla included, so nothing is unmapped (ADR-0037).
COASTAL = FloodHazard(key="coast", dir_name="COAST_DIR", return_periods=(100, 500), unmapped={})
HAZARDS: dict[str, FloodHazard] = {h.key: h for h in (FLUVIAL, COASTAL)}
# Kept for callers that predate the coastal hazard.
RETURN_PERIODS = FLUVIAL.return_periods


class FloodRequestError(ValueError):
    """Invalid request parameters (the API answers 400)."""


@dataclass(frozen=True)
class Circle:
    lat: float
    lon: float
    radius_km: float

    def box(self) -> tuple[float, float, float, float]:
        """(lon_lo, lat_lo, lon_hi, lat_hi) enclosing the circle."""
        dlat = self.radius_km / _KM_PER_DEG_LAT
        dlon = self.radius_km / (_KM_PER_DEG_LAT * max(0.05, math.cos(math.radians(self.lat))))
        return self.lon - dlon, self.lat - dlat, self.lon + dlon, self.lat + dlat

    def contains(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        return haversine_km(self.lat, self.lon, lat, lon) <= self.radius_km


@dataclass(frozen=True)
class AdminArea:
    level: AdminLevel
    code: str

    def provinces(self) -> tuple[str, ...]:
        if self.level == "ccaa":
            return CCAA_PROVINCES[self.code]
        return (self.code[:2],)


Region = Circle | AdminArea


def parse_region(body: dict) -> Region:
    """The request's `region`: `{"type": "circle", lat, lon, radius_km}` or
    `{"type": "admin", level, code}`."""
    kind = body.get("type")
    try:
        if kind == "circle":
            circle = Circle(float(body["lat"]), float(body["lon"]), float(body["radius_km"]))
            if not (0 < circle.radius_km <= MAX_RADIUS_KM):
                raise FloodRequestError(f"radius_km must be in (0, {MAX_RADIUS_KM:g}]")
            if not (-90 <= circle.lat <= 90 and -180 <= circle.lon <= 180):
                raise FloodRequestError("lat/lon out of range")
            return circle
        if kind == "admin":
            level, code = body["level"], str(body["code"])
            valid = {
                "ccaa": code in CCAA_PROVINCES,
                "province": code in _PROVINCES,
                "municipality": len(code) == 5 and code.isdigit() and code[:2] in _PROVINCES,
            }
            if not valid.get(level, False):
                raise FloodRequestError(f"unknown {level} code {code!r}")
            return AdminArea(level, code)
    except (KeyError, TypeError, ValueError) as e:
        if isinstance(e, FloodRequestError):
            raise
        raise FloodRequestError(f"invalid region: {e}") from e
    raise FloodRequestError("region.type must be 'circle' or 'admin'")


def validate_return_period(value: object, hazard: FloodHazard = FLUVIAL) -> int:
    allowed = hazard.return_periods
    try:
        rp = int(value)  # pyrefly: ignore -- checked below
    except (TypeError, ValueError) as e:
        raise FloodRequestError(f"return_period must be one of {allowed}") from e
    if rp not in allowed:
        raise FloodRequestError(f"return_period must be one of {allowed}")
    return rp


def region_params(region: Region) -> dict:
    """The region as the plain dict scenario ids and responses use."""
    if isinstance(region, Circle):
        return {
            "type": "circle",
            "lat": region.lat,
            "lon": region.lon,
            "radius_km": region.radius_km,
        }
    return {"type": "admin", "level": region.level, "code": region.code}


def haversine_km(lat0: float, lon0: float, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    p0, p = math.radians(lat0), np.radians(lat)
    dlat = p - p0
    dlon = np.radians(lon) - math.radians(lon0)
    a = np.sin(dlat / 2) ** 2 + math.cos(p0) * np.cos(p) * np.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.minimum(a, 1.0)))


# --- data, loaded once per process ------------------------------------------


@dataclass
class FloodData:
    lon: np.ndarray
    lat: np.ndarray
    section: np.ndarray  # census section code (object array of str / None)
    municipality: np.ndarray  # INE municipality code
    province: np.ndarray
    dwellings: np.ndarray
    built_area: np.ndarray
    flags: dict[int, np.ndarray]  # return period -> bool (NULL -> False)
    building_id: np.ndarray
    # zone areas: one row per (section, return period)
    zone_rp: np.ndarray
    zone_section: np.ndarray
    zone_area_m2: np.ndarray
    zone_bbox: np.ndarray  # (n, 4): xmin, ymin, xmax, ymax
    infrastructure: pa.Table | None
    # Where these were read from: circles cut by a zone read its geometry
    # (zones.parquet) from here on demand. None: the fluvial FLOOD_DIR.
    data_dir: str | None = None


_DATA: dict[str, FloodData] = {}
_DATA_LOCK = threading.Lock()


def _read(con, path: str) -> pa.Table:
    return con.execute("SELECT * FROM read_parquet(?)", [path]).arrow().read_all()


def load_data(flood_dir: str | None = None, hazard: FloodHazard = FLUVIAL) -> FloodData:
    """Reads one hazard's flood pipeline outputs (local paths or `s3://`)."""
    import duckdb

    from .db import ensure_httpfs, get_connection

    flood_dir = flood_dir or hazard.data_dir
    con = get_connection()
    if flood_dir.startswith("s3://"):
        ensure_httpfs(con)
    try:
        buildings = _read(con, f"{flood_dir}/building_flood.parquet")
        zones = _read(con, f"{flood_dir}/zone_areas.parquet")
    except duckdb.IOException as e:
        # The routes answer FileNotFoundError with "missing pipeline output".
        raise FileNotFoundError(str(e)) from e
    try:
        infrastructure = _read(con, f"{flood_dir}/infrastructure_flood.parquet")
    except duckdb.IOException:
        infrastructure = None  # optional: no infrastructure list then

    def strings(table: pa.Table, name: str) -> np.ndarray:
        return np.array(table.column(name).to_pylist(), dtype=object)

    section = strings(buildings, "census_section_code")
    raw_muni = strings(buildings, "municipality_code")
    # Section codes carry real INE municipality codes; the building's own
    # municipality_code can be Catastro's (55101/56101 for Ceuta/Melilla,
    # see impact.py), so prefer the section's where there is one.
    municipality = np.array(
        [s[:5] if s else _catastro_to_ine(m) for s, m in zip(section, raw_muni)], dtype=object
    )
    flags = {
        rp: buildings.column(f"flood_t{rp}").fill_null(False).to_numpy(zero_copy_only=False)
        for rp in hazard.return_periods
    }
    bbox = np.column_stack(
        [zones.column(c).to_numpy() for c in ("bbox_xmin", "bbox_ymin", "bbox_xmax", "bbox_ymax")]
    )
    return FloodData(
        lon=buildings.column("centroid_lon").to_numpy(),
        lat=buildings.column("centroid_lat").to_numpy(),
        section=section,
        municipality=municipality,
        province=np.array([m[:2] if m else "" for m in municipality], dtype=object),
        dwellings=buildings.column("num_dwellings").fill_null(0).to_numpy().astype(np.float64),
        built_area=buildings.column("built_area_m2").fill_null(0).to_numpy().astype(np.float64),
        flags=flags,
        building_id=strings(buildings, "building_id"),
        zone_rp=zones.column("return_period").to_numpy(),
        zone_section=strings(zones, "section_code"),
        zone_area_m2=zones.column("area_m2").to_numpy(),
        zone_bbox=bbox,
        infrastructure=infrastructure,
        data_dir=flood_dir,
    )


def _catastro_to_ine(code: str | None) -> str:
    code = code or ""
    return {"55101": "51001", "56101": "52001"}.get(code, code)


def flood_data(hazard: FloodHazard = FLUVIAL) -> FloodData:
    with _DATA_LOCK:
        if hazard.key not in _DATA:
            _DATA[hazard.key] = load_data(hazard=hazard)
        return _DATA[hazard.key]


# --- selection ----------------------------------------------------------------


def _admin_mask(area: AdminArea, codes: np.ndarray, provinces: np.ndarray) -> np.ndarray:
    if area.level == "municipality":
        return np.array([c is not None and c[:5] == area.code for c in codes], dtype=bool)
    return np.isin(provinces, area.provinces())


def select_buildings(data: FloodData, region: Region, return_period: int) -> np.ndarray:
    """Indices of the buildings flooded at `return_period` inside `region`."""
    flooded = data.flags[return_period]
    if isinstance(region, Circle):
        lon_lo, lat_lo, lon_hi, lat_hi = region.box()
        candidates = np.flatnonzero(
            flooded
            & (data.lon >= lon_lo)
            & (data.lon <= lon_hi)
            & (data.lat >= lat_lo)
            & (data.lat <= lat_hi)
        )
        inside = region.contains(data.lon[candidates], data.lat[candidates])
        return candidates[inside]
    candidates = np.flatnonzero(flooded)
    keep = _admin_mask(region, data.municipality[candidates], data.province[candidates])
    return candidates[keep]


def flooded_area_by_section(
    data: FloodData, region: Region, return_period: int
) -> dict[str, float]:
    """Flooded m2 per section inside `region` at `return_period`."""
    rows = np.flatnonzero(data.zone_rp == return_period)
    if isinstance(region, AdminArea):
        provinces = np.array([s[:2] for s in data.zone_section[rows]], dtype=object)
        rows = rows[_admin_mask(region, data.zone_section[rows], provinces)]
        return dict(zip(data.zone_section[rows], data.zone_area_m2[rows].astype(float)))

    lon_lo, lat_lo, lon_hi, lat_hi = region.box()
    b = data.zone_bbox[rows]
    rows = rows[
        (b[:, 2] >= lon_lo) & (b[:, 0] <= lon_hi) & (b[:, 3] >= lat_lo) & (b[:, 1] <= lat_hi)
    ]
    b = data.zone_bbox[rows]
    corners_inside = np.all(
        [region.contains(b[:, x], b[:, y]) for x, y in ((0, 1), (0, 3), (2, 1), (2, 3))], axis=0
    )
    areas = {
        s: float(a)
        for s, a in zip(
            data.zone_section[rows[corners_inside]], data.zone_area_m2[rows[corners_inside]]
        )
    }
    straddling = rows[~corners_inside]
    if len(straddling):
        areas.update(
            _clipped_areas(
                data.zone_section[straddling], region, return_period, data.data_dir or FLOOD_DIR
            )
        )
    return {s: a for s, a in areas.items() if a > 0}


def _clipped_areas(
    sections: np.ndarray, circle: Circle, return_period: int, data_dir: str
) -> dict[str, float]:
    """Area of each section's zone piece inside the circle, from the zone
    geometry (read only for these sections)."""
    import shapely
    from pyproj import Transformer

    from .db import ensure_httpfs, get_connection

    con = get_connection()
    if data_dir.startswith("s3://"):
        ensure_httpfs(con)
    lon_lo, lat_lo, lon_hi, lat_hi = circle.box()
    table = (
        con.execute(
            """
        SELECT section_code, geometry FROM read_parquet(?)
        WHERE return_period = ? AND list_contains(?, section_code)
          AND bbox_xmax >= ? AND bbox_xmin <= ? AND bbox_ymax >= ? AND bbox_ymin <= ?
        """,
            [
                f"{data_dir}/zones.parquet",
                return_period,
                sections.tolist(),
                lon_lo,
                lon_hi,
                lat_lo,
                lat_hi,
            ],
        )
        .arrow()
        .read_all()
    )
    geoms = shapely.from_wkb(table.column("geometry").to_numpy(zero_copy_only=False))
    to_laea = Transformer.from_crs(4326, 3035, always_xy=True)
    centre = to_laea.transform(circle.lon, circle.lat)
    # The circle drawn in an equal-area projection around its centre:
    # within the ~200km cap the distortion is well under 1%.
    disk = shapely.Point(centre).buffer(circle.radius_km * 1000.0, quad_segs=32)

    def project(xy: np.ndarray) -> np.ndarray:
        x, y = to_laea.transform(xy[:, 0], xy[:, 1])
        return np.column_stack([x, y])

    clipped = shapely.intersection(shapely.transform(geoms, project), disk)
    return dict(zip(table.column("section_code").to_pylist(), shapely.area(clipped).astype(float)))


def unmapped_provinces(
    region: Region, return_period: int, hazard: FloodHazard = FLUVIAL
) -> list[str]:
    """Provinces in (or, for a circle, possibly in) the region that have no
    map for this return period. Only fluvial Canarias at T=10/T=50 today."""
    unmapped = hazard.unmapped.get(return_period, ())
    if not unmapped:
        return []
    if isinstance(region, AdminArea):
        return [p for p in region.provinces() if p in unmapped]
    # A circle reaching west of -13 degrees can only be touching Canarias.
    lon_lo, _, _, _ = region.box()
    return [p for p in unmapped if p in CANARIAS_PROVINCES] if lon_lo < -13.0 else []


# --- aggregation --------------------------------------------------------------

# Per-area sums: flooded buildings, their dwellings, their built area.
_N_SUMS = 3


def _sum_by_section(data: FloodData, rows: np.ndarray) -> dict[str, np.ndarray]:
    keys = np.array(
        [s if s else f"m:{m}" for s, m in zip(data.section[rows], data.municipality[rows])],
        dtype=object,
    )
    if not len(keys):
        return {}
    uniq, inverse = np.unique(keys, return_inverse=True)
    sums = np.zeros((len(uniq), _N_SUMS))
    np.add.at(sums[:, 0], inverse, 1.0)
    np.add.at(sums[:, 1], inverse, data.dwellings[rows])
    np.add.at(sums[:, 2], inverse, data.built_area[rows])
    return dict(zip(uniq, sums))


def _figures(sums: np.ndarray, area_m2: float, static: dict) -> dict[str, float]:
    """Additive figures for one section (so a municipality's are the sum of
    its sections'). Same population spread as impact._section_figures."""
    n_flooded, dwellings, built_area = sums
    population = float(static.get("population") or 0)
    vulnerable = float((static.get("pop_under_15") or 0) + (static.get("pop_65_plus") or 0))
    total_dwellings = float(static.get("n_dwellings") or 0)
    total_buildings = float(static.get("n_buildings") or 0)
    if total_dwellings > 0:
        share = dwellings / total_dwellings
    elif total_buildings > 0:
        share = n_flooded / total_buildings
    else:
        share = 0.0
    affected = population * min(share, 1.0)
    return {
        "n_flooded": n_flooded,
        "flooded_dwellings": dwellings,
        "flooded_built_area_m2": built_area,
        "affected_population": affected,
        "affected_vulnerable_population": affected * (vulnerable / population if population else 0),
        "flooded_area_m2": area_m2,
    }


def _row(ident: dict, figures: dict[str, float], static: dict) -> dict:
    n_buildings = int(static.get("n_buildings") or 0)
    population = int(static.get("population") or 0)
    vulnerable = int((static.get("pop_under_15") or 0) + (static.get("pop_65_plus") or 0))
    n_flooded = round(figures["n_flooded"])
    return {
        **ident,
        "n_flooded": n_flooded,
        "n_buildings": n_buildings,
        "pct_buildings_flooded": _pct(n_flooded, n_buildings),
        "flooded_dwellings": round(figures["flooded_dwellings"]),
        "population": population,
        "affected_population": round(figures["affected_population"]),
        "pct_population_affected": _pct(figures["affected_population"], population),
        "vulnerable_population": vulnerable,
        "affected_vulnerable_population": round(figures["affected_vulnerable_population"]),
        "pct_vulnerable_affected": _pct(figures["affected_vulnerable_population"], vulnerable),
        "flooded_area_km2": round(figures["flooded_area_m2"] / 1e6, 3),
    }


def _pct(part: float, whole: float) -> float | None:
    return round(100.0 * part / whole, 2) if whole > 0 else None


def _bbox(static: dict) -> list[float] | None:
    keys = ("bbox_xmin", "bbox_ymin", "bbox_xmax", "bbox_ymax")
    return [static[k] for k in keys] if all(static.get(k) is not None for k in keys) else None


@dataclass
class FloodSummary:
    n_flooded: int
    municipality_stats: list[dict]
    section_stats: list[dict]
    totals: dict
    infrastructure: list[dict] | None
    unmapped_provinces: list[str]
    building_ids: np.ndarray


def summarize_flood(
    region: Region,
    return_period: int,
    data: FloodData | None = None,
    meta: AreaMeta | None = None,
    hazard: FloodHazard = FLUVIAL,
) -> FloodSummary:
    data = data or flood_data(hazard)
    meta = meta or area_meta()
    rows = select_buildings(data, region, return_period)
    by_section = _sum_by_section(data, rows)
    areas = flooded_area_by_section(data, region, return_period)

    section_rows = []
    by_muni: dict[str, dict[str, float]] = {}
    for key in sorted(set(by_section) | set(areas)):
        sums = by_section.get(key, np.zeros(_N_SUMS))
        is_section = not key.startswith("m:")
        static = meta.sections.get(key, {}) if is_section else {}
        figures = _figures(sums, areas.get(key, 0.0), static)
        muni = key[:5] if is_section else key[2:]
        total = by_muni.setdefault(muni, dict.fromkeys(figures, 0.0))
        for name, value in figures.items():
            total[name] += value
        if is_section:
            name = f"{static.get('municipality_name') or key[:5]} {key[5:7]}-{key[7:10]}"
            section_rows.append(
                _row(
                    {
                        "section_code": key,
                        "municipality_code": muni,
                        "name": name,
                        "bbox": _bbox(static),
                    },
                    figures,
                    static,
                )
            )

    muni_rows = []
    for code, figures in sorted(by_muni.items()):
        static = meta.municipalities.get(code, {})
        muni_rows.append(
            _row(
                {"municipality_code": code, "name": static.get("name"), "bbox": _bbox(static)},
                figures,
                static,
            )
        )

    totals = {
        "n_flooded": len(rows),
        "flooded_dwellings": int(sum(r["flooded_dwellings"] for r in muni_rows)),
        "affected_population": int(sum(r["affected_population"] for r in muni_rows)),
        "affected_vulnerable_population": int(
            sum(r["affected_vulnerable_population"] for r in muni_rows)
        ),
        "flooded_area_km2": round(sum(r["flooded_area_km2"] for r in muni_rows), 3),
        "n_municipalities": sum(1 for r in muni_rows if r["n_flooded"] > 0),
        "n_sections": sum(1 for r in section_rows if r["n_flooded"] > 0),
    }
    return FloodSummary(
        n_flooded=len(rows),
        municipality_stats=muni_rows,
        section_stats=section_rows,
        totals=totals,
        infrastructure=_infrastructure(data, region, return_period),
        unmapped_provinces=unmapped_provinces(region, return_period, hazard),
        building_ids=data.building_id[rows],
    )


def _infrastructure(data: FloodData, region: Region, return_period: int) -> list[dict] | None:
    """Critical-infrastructure assets in the zone, in the region: the same
    row shape as the seismic ones (infrastructure.py) minus the damage
    fields."""
    table = data.infrastructure
    if table is None:
        return None
    flooded = (
        table.column(f"flood_t{return_period}").fill_null(False).to_numpy(zero_copy_only=False)
    )
    lon = table.column("lon").to_numpy()
    lat = table.column("lat").to_numpy()
    munis = np.array(
        [_catastro_to_ine(m) for m in table.column("municipality_code").to_pylist()], dtype=object
    )
    if isinstance(region, Circle):
        inside = region.contains(lon, lat)
    else:
        inside = _admin_mask(region, munis, np.array([m[:2] for m in munis], dtype=object))
    rows = np.flatnonzero(flooded & inside)
    columns = ["asset_id", "category", "subtype", "name", "lon", "lat"]
    out = [
        {**{c: table.column(c)[int(i)].as_py() for c in columns}, "municipality_code": munis[i]}
        for i in rows
    ]
    out.sort(key=lambda r: (r["category"], r["name"] or "", r["asset_id"]))
    return out


def summarize_assets(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    return counts


def region_bbox(region: Region, meta: AreaMeta | None = None) -> list[float] | None:
    """[west, south, east, north] to fit the map to. Admin areas: the
    union of their municipalities' bounding boxes (census metadata)."""
    if isinstance(region, Circle):
        lon_lo, lat_lo, lon_hi, lat_hi = region.box()
        return [lon_lo, lat_lo, lon_hi, lat_hi]
    meta = meta or area_meta()
    boxes = [
        _bbox(static)
        for code, static in meta.municipalities.items()
        if (
            code == region.code
            if region.level == "municipality"
            else code[:2] in region.provinces()
        )
    ]
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    arr = np.array(boxes)
    return [
        float(arr[:, 0].min()),
        float(arr[:, 1].min()),
        float(arr[:, 2].max()),
        float(arr[:, 3].max()),
    ]


def flood_payload(
    scenario_id: str,
    region: Region,
    return_period: int,
    summary: FloodSummary,
    hazard: FloodHazard = FLUVIAL,
) -> dict:
    """The response body, shared by local.py and handler.py. The section
    rows and infrastructure list are stored separately (fetched through the
    existing /results/{id}/... routes), like a seismic scenario's. Both
    hazards answer the same shape; `hazard` says which ("flood" or
    "coast"), and the parameters stay under `flood` for either."""
    return {
        "scenario_id": scenario_id,
        "hazard": hazard.key,
        "flood": {
            "return_period": return_period,
            "region": region_params(region),
            # Provinces in the region with no map at this return period
            # (Canarias at T=10/T=50): shown as "not mapped", not "safe".
            "unmapped_provinces": summary.unmapped_provinces,
        },
        "region_bbox": region_bbox(region),
        "n_flooded": summary.n_flooded,
        "totals": summary.totals,
        "municipality_stats": summary.municipality_stats,
        "infrastructure_summary": (
            summarize_assets(summary.infrastructure) if summary.infrastructure is not None else None
        ),
    }
