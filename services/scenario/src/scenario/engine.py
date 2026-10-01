"""Orchestrate one scenario run: rupture -> per-building damage.

Loads `buildings.parquet` + `exposure.parquet` (pipelines/exposure output)
and `fragility.parquet` (pipelines/fragility output) via DuckDB
(architecture: docs/milestone-1-plan.md §3/§5), evaluates the Akkar et al.
(2014) GMPE and fragility functions per building, and returns the **thin**
result (docs/decisions/0003-precomputed-building-tiles.md) -- building_id +
damage state + probabilities, no geometry. The frontend joins this onto the
already-published buildings PMTiles layer client-side.

Two entry points over the same streamed chain (`_evaluate_batches`):

- `summarize_scenario`, what local.py/handler.py use: reduces each batch of
  buildings to counts and the few rows the tile joins need as it goes, so
  memory is bounded by the batch size, not by how many buildings a
  scenario evaluates (4-6M near the 300km radius cap).
- `run_scenario`: every evaluated building, including "None" ones, as one
  DataFrame -- for callers that want the full picture (tests, the CLI).
  Memory grows with the building count; not for the API path.
"""

from __future__ import annotations

import math
import time
from collections.abc import Iterator
from dataclasses import dataclass

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc

from .capacity_spectrum import evaluate_capacity_spectrum, load_capacity_table, required_imts
from .damage import DAMAGE_STATES, DamageArrays, evaluate_damage_arrays
from .db import ensure_httpfs, get_connection
from .fragility_lookup import FragilityTable
from .ground_motion import (
    DEFAULT_VS30,
    IM_TYPE_TO_IMT,
    GriddedIntensity,
    estimate_significant_distance_km,
)
from .impact import ImpactCounter
from .methods import DEFAULT_METHOD, DamageMethod
from .response import shipped_buildings_table, thin_buildings_table
from .rupture import Rupture

_KM_PER_DEGREE_LAT = 111.0

# Rows per streamed batch (`_site_batches`). Measured on ES412 "low"
# (6.25M buildings): 250k-500k rows peak at ~1.4-1.6GB RSS end to end vs
# ~3.3GB fully materialized, and ran faster, not slower (fewer, smaller
# temporaries); 1M rows peaked at ~2.2GB.
SITE_BATCH_ROWS = 250_000

_RESULT_COLUMNS = [
    "building_id",
    "lon",
    "lat",
    "municipality_code",
    "damage_state",
    "im_value",
    "im_type",
    "prob_none",
    "prob_slight",
    "prob_moderate",
    "prob_extensive",
    "prob_complete",
]


def _site_batches(
    con: duckdb.DuckDBPyConnection,
    buildings_path: str,
    exposure_path: str,
    rupture: Rupture,
    max_distance_km: float,
    batch_rows: int = SITE_BATCH_ROWS,
) -> tuple[Iterator[pa.RecordBatch], float]:
    """Every building in range, as a stream of Arrow record batches of at
    most `batch_rows` rows, plus the box's center latitude (the fixed
    reference `GriddedIntensity` sizes its cells by).

    Streamed, not materialized: a σ=1 scenario near the 300km radius cap
    evaluates 4-6M buildings, and turning all of them into one DataFrame
    (`.df()`) peaked at ~3.3GB on its own -- the scenario Lambda's whole
    3,008MB, where every such request died with `Runtime.OutOfMemory`
    (measured on the 2026-09 cache-warm sweep, 49 of 603 scenarios). Batch
    by batch, peak memory tracks `batch_rows` instead of the building
    count."""
    lon_lo, lon_hi, lat_lo, lat_hi = site_box(rupture, max_distance_km)
    reader = _query_sites(
        con,
        buildings_path,
        exposure_path,
        (lon_lo, lon_hi, lat_lo, lat_hi),
        batch_rows,
    )
    return iter(reader), (lat_lo + lat_hi) / 2


def site_box(rupture: Rupture, max_distance_km: float) -> tuple[float, float, float, float]:
    """(lon_lo, lon_hi, lat_lo, lat_hi): the box everything a scenario
    evaluates is drawn from -- buildings (`_site_batches`), and the
    infrastructure assets and intensity grid (infrastructure.py), so all
    three agree on what "in range" means.
    """
    # A simple lat/lon degree bounding box, not a true geodesic radius --
    # cheap to evaluate and generous enough (longitude degrees narrow
    # towards the poles, so this box is always at least as wide as a true
    # circle of the same radius, never narrower) that it can't wrongly
    # exclude an in-range building.
    #
    # Padded around the rupture *surface's* own extent when one exists,
    # not just `rupture.lat`/`rupture.lon` (a single representative point
    # on the trace -- see rupture.py). A single-point box is a correctness
    # bug for a long fault: QAFI's longest traces run past 100km, so a site
    # near the *far* end of the trace but still within max_distance_km of
    # it can sit well outside a box only padded around the *near* end,
    # and get silently excluded rather than correctly evaluated (and,
    # likely, correctly found undamaged). Sizing the box off the surface's
    # own mesh instead means it always covers the whole trace, regardless
    # of the fault's own length.
    if rupture.surface is not None:
        mesh = rupture.surface.mesh
        assert mesh is not None  # always populated once a surface is built
        lon_min, lon_max = float(mesh.lons.min()), float(mesh.lons.max())
        lat_min, lat_max = float(mesh.lats.min()), float(mesh.lats.max())
    else:
        lon_min = lon_max = rupture.lon
        lat_min = lat_max = rupture.lat

    lat_pad = max_distance_km / _KM_PER_DEGREE_LAT
    lon_pad = max_distance_km / (
        _KM_PER_DEGREE_LAT * max(0.1, abs(_cos_deg((lat_min + lat_max) / 2)))
    )

    return (lon_min - lon_pad, lon_max + lon_pad, lat_min - lat_pad, lat_max + lat_pad)


def _query_sites(
    con: duckdb.DuckDBPyConnection,
    buildings_path: str,
    exposure_path: str,
    box: tuple[float, float, float, float],
    batch_rows: int,
) -> pa.RecordBatchReader:
    """Every building in `box` (lon_lo, lon_hi, lat_lo, lat_hi), with the
    exposure attributes a scenario needs, as a stream of Arrow batches.
    The one query both `_site_batches` and `warm_site_query` run."""
    if buildings_path.startswith("s3://") or exposure_path.startswith("s3://"):
        # httpfs + DuckDB's default AWS credential chain (picks up the
        # Lambda execution role automatically) -- no explicit credentials
        # wired here, matching S3 access via IAM rather than secrets.
        ensure_httpfs(con)
    lon_lo, lon_hi, lat_lo, lat_hi = box
    # centroid_lon/centroid_lat are precomputed columns (pipelines/exposure,
    # see parse.py's add_spatial_index_columns), not derived here via
    # ST_Centroid -- this is the fix from docs/validation-region-expansion.md
    # §4: filtering on plain stored columns lets DuckDB's parquet reader
    # prune whole row groups/files by their min/max statistics, and skips
    # reading the (much larger) geometry column for this query entirely.
    # Measured: ~14x faster than the ST_Centroid-on-the-fly equivalent for a
    # regional bounding-box query (see docs/decisions/0006).
    return con.execute(
        f"""
        SELECT
            b.building_id,
            b.centroid_lon AS lon,
            b.centroid_lat AS lat,
            b.municipality_code,
            COALESCE(b.vs30, ?) AS vs30,
            {_impact_columns(con, buildings_path)},
            e.taxonomy_class,
            e.height_class
        FROM read_parquet(?) AS b
        JOIN read_parquet(?) AS e USING (building_id)
        WHERE b.centroid_lon BETWEEN ? AND ?
          AND b.centroid_lat BETWEEN ? AND ?
        """,
        [DEFAULT_VS30, buildings_path, exposure_path, lon_lo, lon_hi, lat_lo, lat_hi],
    ).to_arrow_reader(batch_rows)


# Columns the impact estimates (impact.py, ADR-0024) read, with the value
# used when the buildings file predates them: the census-section sites
# file (pipelines/exposure census_sections.py) has all three; the plain
# `*.buildings.parquet` parts have `num_dwellings` but no section or
# built area. A missing column degrades those estimates, never the damage
# result itself.
_IMPACT_COLUMNS = {
    "census_section_code": "NULL::VARCHAR",
    "num_dwellings": "0",
    "built_area_m2": "0.0",
}
_impact_columns_sql: dict[str, str] = {}


def _impact_columns(con: duckdb.DuckDBPyConnection, buildings_path: str) -> str:
    """SELECT list for `_IMPACT_COLUMNS`, probed once per buildings path."""
    if buildings_path not in _impact_columns_sql:
        present = {
            row[0]
            for row in con.execute(
                "DESCRIBE SELECT * FROM read_parquet(?) LIMIT 0", [buildings_path]
            ).fetchall()
        }
        _impact_columns_sql[buildings_path] = ", ".join(
            f"COALESCE(b.{name}, {default}) AS {name}"
            if name in present
            else f"{default} AS {name}"
            for name, default in _IMPACT_COLUMNS.items()
        )
    return _impact_columns_sql[buildings_path]


# A ~1km box in central Madrid: small enough to be cheap, real enough to
# return rows (so every stage of the query actually runs).
_WARM_BOX = (-3.708, -3.699, 40.412, 40.421)


def warm_site_query(buildings_path: str, exposure_path: str) -> int:
    """Run the scenario's own building query over a tiny box, for /warmup
    (warmup.py): the first real query in a fresh environment paid ~7.7s
    for its first batch vs ~2.4s warm (2026-09-25) -- S3 connection
    setup, both files' parquet footers (kept afterwards by DuckDB's
    external file cache and parquet metadata cache, db.py), and first
    use of the join/Arrow code. Returns the row count, for the log."""
    reader = _query_sites(
        get_connection(), buildings_path, exposure_path, _WARM_BOX, SITE_BATCH_ROWS
    )
    return sum(batch.num_rows for batch in reader)


def _cos_deg(degrees: float) -> float:
    return math.cos(math.radians(degrees))


def run_scenario(
    rupture: Rupture,
    buildings_path: str,
    exposure_path: str,
    fragility_path: str,
    max_distance_km: float | None = None,
    sigma_multiplier: float = 0.0,
    damage_percentile: float | None = None,
    method: DamageMethod = DEFAULT_METHOD,
) -> pd.DataFrame:
    """Run the full scenario chain and return the thin per-building result.

    `buildings_path`/`exposure_path` may be glob patterns (e.g.
    `parts/*.buildings.parquet`, per ADR-0005) as well as single files --
    DuckDB's `read_parquet` accepts both.

    `max_distance_km`: search radius for the spatial pre-filter. Defaults
    to `None`, meaning "derive it from this rupture's own magnitude/rake"
    via `estimate_significant_distance_km` (ground_motion.py) rather than a
    flat constant -- a small earthquake shouldn't pay to scan 300km of
    buildings it can't possibly affect. Pass an explicit value to override
    (e.g. tests pinning a known radius).

    `sigma_multiplier`/`damage_percentile`: MERISUR's probability-level
    selector (`probability_level.py`, `docs/merisur.md` §4.7) -- callers
    resolve a `ProbabilityLevel` ("high"/"low"/"very_low") to these two via
    `resolve_probability_level` and pass the result straight through. Both
    default to today's only behaviour (median ground motion, modal damage
    state) so an existing caller that doesn't pass them is unaffected. When
    `max_distance_km` is left as `None`, the derived radius uses the same
    `sigma_multiplier` -- see `estimate_significant_distance_km`'s own
    docstring for why that consistency matters.

    Columns: building_id, lon, lat, municipality_code, damage_state,
    im_value, im_type, prob_none, prob_slight, prob_moderate,
    prob_extensive, prob_complete.
    `lon`/`lat` (the same precomputed centroid columns `_site_batches`
    already reads) ride along so a caller that keeps only a subset of rows
    (local.py/handler.py drop the confidently-undamaged majority, see
    their own docstrings) can still place the ones it keeps on a map
    without a second lookup. `municipality_code` is the plain INE/Foral
    code column pipelines/exposure now stamps onto every building at
    ingest time (`pipeline.build_exposure`) -- a column read, not a
    per-request spatial join, is what lets `response.compute_municipality_stats`
    aggregate cheaply. `im_value`/`im_type` are the ground-motion
    value and intensity-measure type each building was *actually*
    evaluated against -- see `evaluate_damage_batch`'s docstring for why
    that varies by building instead of being one scenario-wide SA(0.3s)
    value (docs/validation-lorca-2011.md §10.2).
    """
    if max_distance_km is None:
        max_distance_km = estimate_significant_distance_km(
            rupture, sigma_multiplier=sigma_multiplier
        )

    frames = [
        pd.concat(
            [
                batch.select(["building_id", "lon", "lat", "municipality_code"]).to_pandas(),
                pd.DataFrame(
                    {
                        "damage_state": np.array(DAMAGE_STATES, dtype=object)[
                            damage.damage_state_code
                        ],
                        "im_value": damage.im_value,
                        "im_type": np.array(damage.im_types, dtype=object)[damage.im_type_code],
                        **{
                            f"prob_{state.lower()}": damage.probs[i]
                            for i, state in enumerate(DAMAGE_STATES)
                        },
                    }
                ),
            ],
            axis=1,
        )
        for batch, damage in _evaluate_batches(
            rupture,
            buildings_path,
            exposure_path,
            fragility_path,
            max_distance_km,
            sigma_multiplier,
            damage_percentile,
            method=method,
        )
    ]
    if not frames:
        return pd.DataFrame(columns=_RESULT_COLUMNS)
    return pd.concat(frames, ignore_index=True)


@dataclass
class ScenarioSummary:
    """What local.py/handler.py actually need from a scenario, without the
    full per-building result: the evaluated count, per-census-section
    damage-state counts, and the thin rows for the buildings the tile joins
    list (damaged or uncertain -- `response.shipped_mask`)."""

    n_evaluated: int
    areas: ImpactCounter
    shipped: pa.Table
    # Thin rows (same columns as `shipped`) for every evaluated building in
    # `track_building_ids`, damaged or not -- the critical-infrastructure
    # facilities' buildings (ADR-0025), which report their building's full
    # damage distribution even when it's a confident "None" that `shipped`
    # leaves out. None when nothing was tracked.
    tracked: pa.Table | None = None
    # From the call until the first batch of sites was evaluated: query
    # setup plus the first S3 reads, in the deployed stack -- logged by
    # handler.py to tell setup cost apart from per-building compute.
    seconds_to_first_batch: float = 0.0

    @property
    def n_damaged(self) -> float:
        """Expected damaged buildings (summed probabilities, ADR-0034)."""
        return self.areas.n_damaged

    @property
    def n_damaged_reported(self) -> int:
        """Buildings whose reported state isn't None."""
        return self.areas.n_damaged_reported


def summarize_scenario(
    rupture: Rupture,
    buildings_path: str,
    exposure_path: str,
    fragility_path: str,
    max_distance_km: float | None = None,
    sigma_multiplier: float = 0.0,
    damage_percentile: float | None = None,
    batch_rows: int = SITE_BATCH_ROWS,
    track_building_ids: pa.Array | None = None,
    method: DamageMethod = DEFAULT_METHOD,
) -> ScenarioSummary:
    """`run_scenario`'s chain (same arguments, same per-building results),
    reduced batch by batch to a `ScenarioSummary` as the buildings stream
    through, so memory stays bounded by `batch_rows` rather than by how
    many buildings the scenario evaluates. This is the path the API uses."""
    if max_distance_km is None:
        max_distance_km = estimate_significant_distance_km(
            rupture, sigma_multiplier=sigma_multiplier
        )

    t0 = time.monotonic()
    seconds_to_first_batch = 0.0
    n_evaluated = 0
    areas = ImpactCounter()
    shipped = []
    tracked = []
    for batch, damage in _evaluate_batches(
        rupture,
        buildings_path,
        exposure_path,
        fragility_path,
        max_distance_km,
        sigma_multiplier,
        damage_percentile,
        batch_rows,
        method=method,
    ):
        if n_evaluated == 0:
            seconds_to_first_batch = time.monotonic() - t0
        n_evaluated += batch.num_rows
        areas.add(
            batch.column("municipality_code"),
            batch.column("census_section_code"),
            damage.damage_state_code,
            batch.column("num_dwellings").to_numpy(zero_copy_only=False).astype(np.float64),
            batch.column("built_area_m2").to_numpy(zero_copy_only=False).astype(np.float64),
            probs=damage.probs,
        )
        shipped.append(
            shipped_buildings_table(
                batch.column("building_id"), damage.damage_state_code, damage.probs
            )
        )
        if track_building_ids is not None:
            keep = (
                pc.is_in(  # pyrefly: ignore -- pyarrow ships no stub for compute functions
                    batch.column("building_id"), value_set=track_building_ids
                )
                .to_numpy(zero_copy_only=False)
                .astype(bool)
            )
            if keep.any():
                tracked.append(
                    thin_buildings_table(
                        batch.column("building_id"), damage.damage_state_code, damage.probs, keep
                    )
                )
    shipped_table = (
        pa.concat_tables(shipped)
        if shipped
        else shipped_buildings_table(
            pa.array([], pa.string()), np.zeros(0, np.int8), np.zeros((len(DAMAGE_STATES), 0))
        )
    )
    tracked_table = None
    if track_building_ids is not None:
        tracked_table = (
            pa.concat_tables(tracked)
            if tracked
            else thin_buildings_table(
                pa.array([], pa.string()),
                np.zeros(0, np.int8),
                np.zeros((len(DAMAGE_STATES), 0)),
                np.zeros(0, bool),
            )
        )
    return ScenarioSummary(
        n_evaluated,
        areas,
        shipped_table,
        tracked=tracked_table,
        seconds_to_first_batch=seconds_to_first_batch,
    )


def _evaluate_batches(
    rupture: Rupture,
    buildings_path: str,
    exposure_path: str,
    fragility_path: str,
    max_distance_km: float,
    sigma_multiplier: float,
    damage_percentile: float | None,
    batch_rows: int = SITE_BATCH_ROWS,
    method: DamageMethod = DEFAULT_METHOD,
) -> Iterator[tuple[pa.RecordBatch, DamageArrays]]:
    """Ground motion + damage for each streamed batch of sites -- the one
    chain both `run_scenario` and `summarize_scenario` are built on.

    `method` picks the damage model and vulnerability database (methods.py,
    ADR-0033); callers validate it with `resolve_damage_method` first."""
    con = get_connection()
    batches, ref_lat = _site_batches(
        con, buildings_path, exposure_path, rupture, max_distance_km, batch_rows
    )
    if method.model == "capacity_spectrum":
        capacity_table = load_capacity_table(method.database)
        imts = required_imts(capacity_table)

        def damage_for(batch: pa.RecordBatch, ims: dict[str, np.ndarray]) -> DamageArrays:
            return evaluate_capacity_spectrum(
                capacity_table,
                batch.column("taxonomy_class"),
                batch.column("height_class").to_numpy(),
                ims,
                damage_percentile=damage_percentile,
            )
    else:
        fragility_table = FragilityTable.from_parquet(fragility_path)
        # Only the IM types this fragility set actually vendors (FragilityTable.
        # used_im_types), not every entry in IM_TYPE_TO_IMT -- avoids paying for
        # a GMPE evaluation of an IM type nothing here is indexed by.
        imts = {im: IM_TYPE_TO_IMT[im] for im in sorted(fragility_table.used_im_types())}

        def damage_for(batch: pa.RecordBatch, ims: dict[str, np.ndarray]) -> DamageArrays:
            return evaluate_damage_arrays(
                fragility_table,
                batch.column("taxonomy_class"),
                batch.column("height_class").to_numpy(),
                ims,
                damage_percentile=damage_percentile,
            )

    # One grid for the whole scenario, shared by every batch (see
    # GriddedIntensity).
    grid = GriddedIntensity(rupture, imts, ref_lat, sigma_multiplier=sigma_multiplier)
    for batch in batches:
        if batch.num_rows == 0:
            continue
        im_values_by_type = grid.evaluate(
            batch.column("lat").to_numpy(),
            batch.column("lon").to_numpy(),
            batch.column("vs30").to_numpy(),
        )
        yield batch, damage_for(batch, im_values_by_type)
