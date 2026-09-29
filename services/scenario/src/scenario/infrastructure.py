"""Critical infrastructure and intensity bands for a scenario (ADR-0025).

Two outputs, both computed after the buildings (`engine.summarize_scenario`):

- **Per-asset results** (`evaluate_assets`): every asset from the BTN
  pipeline (pipelines/exposure infrastructure.py) inside the scenario's
  site box gets an estimated macroseismic intensity at its own location.
  Facilities that sit on a Catastro building also get that building's
  damage state from this same run -- the one building model, not a
  separate one. Only assets at `AFFECTED_INTENSITY` or above, or whose
  building is damaged, are kept.
- **Intensity bands** (`intensity_bands`): the same intensity on a regular
  grid over the site box, contoured into one (multi)polygon per integer
  level -- the map's toggleable bands layer.

Intensity is Worden et al. (2012)'s PGV -> MMI conversion (the equations
USGS ShakeMap implements as WGRW12, without the optional distance/
magnitude residual terms), applied to the scenario's own GMPE PGV --
chosen over the PGA equation for its slightly lower scatter (0.63 vs 0.66
intensity units). MMI and EMS-98 are broadly equivalent at these levels,
so the UI labels it "EMS-98 (est.)". Asset and grid PGV use the same
`sigma_multiplier` as the buildings, so all three reflect the chosen
probability level.

Everything here is optional at runtime: with no infrastructure data
deployed, `load_assets` returns None and a scenario simply has no
infrastructure results -- the building results are unaffected.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import shapely
from contourpy import FillType, contour_generator
from openquake.hazardlib.imt import PGV
from scipy.spatial import (
    cKDTree,  # pyrefly: ignore -- no stub for this compiled extension re-export
)

from .damage import DAMAGE_STATES
from .engine import site_box
from .ground_motion import DEFAULT_VS30, GriddedIntensity, compute_intensity
from .rupture import Rupture


def _infra_path(env_var: str, filename: str) -> str:
    """Read per call, not at import: the same TWINER_DATA_DIR convention as
    local.py's paths, individually overridable (e.g. an s3:// URI)."""
    data_dir = os.environ.get("TWINER_DATA_DIR", "data")
    return os.environ.get(env_var, f"{data_dir}/infrastructure/{filename}")


def _read_optional(path: str) -> pa.Table | None:
    """The parquet at `path` (local or `s3://`), or None if it isn't there.
    Read through the same shared DuckDB + httpfs as every other S3 read in
    this service (impact.AreaMeta.load), the path proven in the Lambda
    image."""
    import duckdb

    from .db import ensure_httpfs, get_connection

    con = get_connection()
    if path.startswith("s3://"):
        ensure_httpfs(con)
    try:
        return con.execute("SELECT * FROM read_parquet(?)", [path]).arrow().read_all()
    except duckdb.IOException:
        return None


# EMS-98 VI ("slightly damaging") -- the first level at which the scale
# describes damage to ordinary buildings, and the level Spain's seismic
# civil-protection planning guideline works from. See ADR-0025.
AFFECTED_INTENSITY = 6.0

# Lowest band drawn. Below IV (largely observed) nothing on the map would
# change, and the polygons get large for no information.
MIN_BAND = 4
MAX_BAND = 10

# Intensity grid resolution: at least 1 km (the building engine's own
# `SA_GRID_CELL_KM`), coarser for large site boxes so the grid never
# exceeds about MAX_GRID_CELLS cells per side.
MIN_GRID_CELL_KM = 1.0
MAX_GRID_CELLS = 400

_KM_PER_DEGREE_LAT = 111.32

# Worden et al. (2012), PGV branch (cm/s), as in ShakeMap's WGRW12:
# MMI = C1 + C2 log10(PGV) below T1, C3 + C4 log10(PGV) at or above it.
_WGRW12_PGV = {"C1": 3.78, "C2": 1.47, "C3": 2.89, "C4": 3.16, "T1": 0.53}


def mmi_from_pgv(pgv_cm_s: np.ndarray) -> np.ndarray:
    """Worden et al. (2012) intensity from PGV (cm/s), clipped to 1-10."""
    c = _WGRW12_PGV
    log_pgv = np.log10(np.maximum(pgv_cm_s, 1e-6))
    mmi = np.where(log_pgv < c["T1"], c["C1"] + c["C2"] * log_pgv, c["C3"] + c["C4"] * log_pgv)
    return np.clip(mmi, 1.0, 10.0)


# eq=False: hashed by identity (the arrays aren't hashable), which is what
# `_facility_building_ids`' cache wants -- one loaded table, one entry.
@dataclass(frozen=True, eq=False)
class Assets:
    """infrastructure_sites.parquet, as columns."""

    table: pa.Table
    lon: np.ndarray
    lat: np.ndarray
    vs30: np.ndarray


def load_assets() -> Assets | None:
    return _load_assets(_infra_path("TWINER_INFRA_SITES_PATH", "infrastructure_sites.parquet"))


@lru_cache(maxsize=1)
def _load_assets(path: str) -> Assets | None:
    table = _read_optional(path)
    if table is None:
        return None
    vs30 = table.column("vs30").to_numpy(zero_copy_only=False).astype(np.float64)
    return Assets(
        table=table,
        lon=table.column("lon").to_numpy(),
        lat=table.column("lat").to_numpy(),
        # Same fallback as buildings (engine._query_sites' COALESCE).
        vs30=np.where(np.isnan(vs30), DEFAULT_VS30, vs30),
    )


def _vs30_lookup() -> tuple[cKDTree, np.ndarray] | None:
    return _load_vs30_lookup(_infra_path("TWINER_VS30_SITES_PATH", "vs30_sites.parquet"))


@lru_cache(maxsize=1)
def _load_vs30_lookup(path: str) -> tuple[cKDTree, np.ndarray] | None:
    table = _read_optional(path)
    if table is None:
        return None
    points = np.column_stack(
        [table.column("lon").to_numpy(), table.column("lat").to_numpy()]
    ).astype(np.float64)
    return cKDTree(points), table.column("vs30").to_numpy().astype(np.float64)


# Same cutoff as pipelines/exposure vs30.py's _MAX_LOOKUP_DISTANCE_DEG:
# further than this from any ESRM20 point (sea, Canarias) -> default.
_VS30_MAX_DISTANCE_DEG = 0.025


def _grid_vs30(lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    lookup = _vs30_lookup()
    if lookup is None:
        return np.full(len(lons), DEFAULT_VS30)
    tree, values = lookup
    distances, indices = tree.query(np.column_stack([lons, lats]))
    return np.where(distances <= _VS30_MAX_DISTANCE_DEG, values[indices], DEFAULT_VS30)


def facility_building_ids() -> pa.Array | None:
    """The Catastro buildings facilities sit on, for the engine to track
    (`summarize_scenario(track_building_ids=...)`), so each facility gets
    its building's full damage distribution. None with no asset data."""
    assets = load_assets()
    if assets is None:
        return None
    return _facility_building_ids(assets)


@lru_cache(maxsize=1)
def _facility_building_ids(assets: Assets) -> pa.Array:
    return assets.table.column("building_id").drop_null().unique()


_PROB_COLUMNS = [f"prob_{state.lower()}" for state in DAMAGE_STATES]


def evaluate_assets(
    rupture: Rupture,
    max_distance_km: float,
    sigma_multiplier: float,
    tracked: pa.Table | None,
) -> list[dict] | None:
    """Affected assets for this scenario, one dict per asset, most intense
    first. None when no infrastructure data is deployed.

    `tracked`: the facilities' buildings as this scenario evaluated them
    (`ScenarioSummary.tracked`: building_id, damage_state_code, prob_*).
    A facility whose building isn't in it wasn't evaluated (outside the
    site box) and gets no damage, the same as a non-building asset.
    """
    assets = load_assets()
    if assets is None:
        return None
    lon_lo, lon_hi, lat_lo, lat_hi = site_box(rupture, max_distance_km)
    in_box = np.flatnonzero(
        (assets.lon >= lon_lo)
        & (assets.lon <= lon_hi)
        & (assets.lat >= lat_lo)
        & (assets.lat <= lat_hi)
    )
    if len(in_box) == 0:
        return []

    # Same 1 km cells as the buildings' own ground motion
    # (engine._evaluate_batches), so an asset and the building next to it
    # see the same shaking.
    gridded = GriddedIntensity(
        rupture, {"PGV": PGV()}, ref_lat=(lat_lo + lat_hi) / 2, sigma_multiplier=sigma_multiplier
    )
    pgv = gridded.evaluate(assets.lat[in_box], assets.lon[in_box], assets.vs30[in_box])["PGV"]
    mmi = mmi_from_pgv(pgv)

    rows = assets.table.take(pa.array(in_box))
    position = _tracked_position(rows.column("building_id"), tracked)
    codes = (
        tracked.column("damage_state_code").to_numpy()
        if tracked is not None and tracked.num_rows
        else np.zeros(0, np.int64)
    )
    damage = np.where(position >= 0, codes[np.maximum(position, 0)] if len(codes) else 0, 0)
    keep = (mmi >= AFFECTED_INTENSITY) | (damage > 0)
    rows = rows.filter(pa.array(keep))
    mmi, position = mmi[keep], position[keep]
    probs = (
        np.column_stack([tracked.column(c).to_numpy() for c in _PROB_COLUMNS])
        if tracked is not None and tracked.num_rows
        else np.zeros((0, len(_PROB_COLUMNS)))
    )

    out = []
    columns = ["asset_id", "category", "subtype", "name", "municipality_code", "lon", "lat"]
    for i, row in enumerate(rows.select(columns).to_pylist()):
        row["lon"] = round(row["lon"], 5)
        row["lat"] = round(row["lat"], 5)
        row["intensity"] = round(float(mmi[i]), 1)
        # Only facilities whose building this scenario evaluated have a
        # damage state; for everything else there's no model, and null
        # says so. The distribution is the building's own (the same rows
        # the building tiles show), not just its most likely state.
        if position[i] >= 0:
            row["damage_state_code"] = int(codes[position[i]])
            row["damage_probs"] = [round(float(p), 3) for p in probs[position[i]]]
        else:
            row["damage_state_code"] = None
            row["damage_probs"] = None
        out.append(row)
    out.sort(key=lambda r: (-r["intensity"], r["asset_id"]))
    return out


def _tracked_position(building_ids: pa.ChunkedArray, tracked: pa.Table | None) -> np.ndarray:
    """Each asset's building's row in `tracked`, -1 when it has none."""
    if tracked is None or tracked.num_rows == 0:
        return np.full(len(building_ids), -1, dtype=np.int64)
    # pyarrow ships no stub for its generated compute functions.
    idx = pc.index_in(  # pyrefly: ignore
        building_ids, value_set=tracked.column("building_id")
    )
    return pc.fill_null(idx, -1).to_numpy(zero_copy_only=False).astype(np.int64)


def summarize_assets(rows: list[dict]) -> dict[str, int]:
    """Affected-asset counts by category -- the response's small summary;
    the rows themselves are fetched separately."""
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["category"]] = counts.get(row["category"], 0) + 1
    return counts


def intensity_bands(rupture: Rupture, max_distance_km: float, sigma_multiplier: float) -> dict:
    """GeoJSON FeatureCollection: one feature per integer intensity level
    from MIN_BAND up, `{"intensity": n}`, covering where the estimate is
    in [n, n+1) (the top band: n and above)."""
    lon_lo, lon_hi, lat_lo, lat_hi = site_box(rupture, max_distance_km)
    ref_lat = (lat_lo + lat_hi) / 2
    km_per_deg_lon = _KM_PER_DEGREE_LAT * max(0.1, math.cos(math.radians(ref_lat)))
    extent_km = max((lon_hi - lon_lo) * km_per_deg_lon, (lat_hi - lat_lo) * _KM_PER_DEGREE_LAT)
    cell_km = max(MIN_GRID_CELL_KM, extent_km / MAX_GRID_CELLS)
    lons = np.arange(lon_lo, lon_hi + 1e-9, cell_km / km_per_deg_lon)
    lats = np.arange(lat_lo, lat_hi + 1e-9, cell_km / _KM_PER_DEGREE_LAT)
    grid_lon, grid_lat = np.meshgrid(lons, lats)
    flat_lon, flat_lat = grid_lon.ravel(), grid_lat.ravel()

    pgv = compute_intensity(
        rupture, flat_lat, flat_lon, PGV(), _grid_vs30(flat_lon, flat_lat), sigma_multiplier
    )
    mmi = mmi_from_pgv(pgv).reshape(grid_lon.shape)

    generator = contour_generator(lons, lats, mmi, fill_type=FillType.OuterOffset)
    # Half a cell: removes the stair-steps the grid itself adds, nothing
    # the grid actually resolved.
    tolerance = 0.5 * cell_km / km_per_deg_lon
    features = []
    for level in range(MIN_BAND, MAX_BAND + 1):
        upper = level + 1 if level < MAX_BAND else 11.0
        polygons = _filled_polygons(generator.filled(level, upper))
        if not polygons:
            continue
        geometry = shapely.simplify(shapely.MultiPolygon(polygons), tolerance)
        if geometry.is_empty:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"intensity": level},
                "geometry": shapely.geometry.mapping(shapely.set_precision(geometry, 1e-4)),
            }
        )
    return {"type": "FeatureCollection", "features": features, "cell_km": round(cell_km, 2)}


def _filled_polygons(filled) -> list[shapely.Polygon]:
    """contourpy's OuterOffset output -> shapely polygons (outer ring first,
    then its holes, split by the offsets)."""
    polygons = []
    points_list, offsets_list = filled
    for points, offsets in zip(points_list, offsets_list, strict=True):
        rings = [points[offsets[i] : offsets[i + 1]] for i in range(len(offsets) - 1)]
        rings = [r for r in rings if len(r) >= 4]
        if rings:
            polygons.append(shapely.Polygon(rings[0], rings[1:]))
    return polygons


def summarize_infrastructure(
    rupture: Rupture, max_distance_km: float, sigma_multiplier: float, tracked: pa.Table | None
) -> tuple[list[dict] | None, dict]:
    """Both of a scenario's ADR-0025 outputs, as local.py and handler.py
    store them: affected asset rows (None with no infrastructure data
    deployed) and the intensity bands GeoJSON."""
    return (
        evaluate_assets(rupture, max_distance_km, sigma_multiplier, tracked),
        intensity_bands(rupture, max_distance_km, sigma_multiplier),
    )
