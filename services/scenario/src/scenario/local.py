"""Local dev entrypoint for the scenario function.

Runs the same domain logic (engine.summarize_scenario) as the Lambda handler
(handler.py), behind a small FastAPI app instead of API Gateway. This is the
"local ↔ cloud parity" adapter split from docs/decisions/0001-compute-and-iac.md
-- only this file and handler.py know about their respective runtimes.

Run with: uv run --package twiner-scenario uvicorn scenario.local:app --reload
"""

from __future__ import annotations

import asyncio
import os
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, ConfigDict, Field

from . import api_models
from .api_models import errors, ok
from .building_lookup import get_building
from .engine import summarize_scenario
from .faults import faults_payload, get_fault, round_near_point, rupture_anchor
from .flood import (
    FloodRequestError,
    flood_payload,
    parse_region,
    region_params,
    summarize_flood,
    validate_return_period,
)
from .ground_motion import estimate_significant_distance_km
from .impact import section_severity
from .infrastructure import facility_building_ids, summarize_assets, summarize_infrastructure
from .methods import (
    DEFAULT_DAMAGE_MODEL,
    DEFAULT_METHOD,
    DEFAULT_VULNERABILITY_DB,
    DamageMethod,
    methods_payload,
    resolve_damage_method,
)
from .probability_level import ProbabilityLevel, resolve_probability_level
from .realtime import RealtimeUnavailable, aemet_observations, aemet_warnings, dgt_incidents
from .response import evaluated_region, stored_results_columns
from .results_store import (
    INFRASTRUCTURE_FILE,
    INTENSITY_FILE,
    init_scenario,
    read_artifact,
    read_municipality_stats,
    read_response,
    read_section_stats,
    read_status,
    write_artifact,
    write_buildings,
    write_municipality_stats,
    write_response,
    write_section_stats,
)
from .rupture import Rupture, from_fault, from_manual_input
from .scenario_id import (
    API_VERSION,
    cache_enabled,
    fault_scenario_id,
    flood_scenario_id,
    manual_scenario_id,
)
from .tile_join import join_tile, warm_cache
from .warmup import warm_up

app = FastAPI(
    title="TWIN-ER API",
    version=API_VERSION,
    description=api_models.API_DESCRIPTION,
    openapi_tags=api_models.OPENAPI_TAGS,
    servers=[{"url": "http://localhost:8000", "description": "Local development server"}],
    # Operation ids become the docs' page URLs: /docs/api/operations/list_faults/.
    generate_unique_id_function=lambda route: route.name,
)

# join_tile does real CPU work per call (MVT decode + re-encode --
# mapbox_vector_tile.encode alone measured ~0.4s for a mid-size tile, pure
# Python). A map viewport fires a dozen-plus tile requests at once; a sync
# route (FastAPI's default thread pool) hits the GIL and serializes that
# CPU work across them instead of overlapping it, measured to stack up to
# ~3s for the last tile in a burst of 12. A process pool sidesteps the GIL
# so concurrent tile requests genuinely run in parallel across cores.
# Capped at 8 rather than the host's full core count -- this is a local
# dev convenience, not something that needs to saturate the machine.
_TILE_POOL_WORKERS = min(os.cpu_count() or 4, 8)
_TILE_POOL = ProcessPoolExecutor(max_workers=_TILE_POOL_WORKERS)

# Dev-only: the Vite dev server runs on a different origin. Locked down
# properly once there's a real deployed frontend origin to allow instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# The `buildings` payload is repetitive JSON (short keys, floats over
# millions of similar rows) -- it compresses extremely well. Starlette only
# compresses responses at/above `minimum_size`, so tiny error responses
# aren't touched.
app.add_middleware(GZipMiddleware, minimum_size=1024)

DATA_DIR = os.environ.get("TWINER_DATA_DIR", "data")
# Individually overridable (mirrors handler.py) -- needed once
# buildings.parquet is a partitioned glob rather than a single file
# (ADR-0005), which doesn't fit the single-DATA_DIR convention. `data/
# exposure` is now the one consolidated national dataset (Lorca-only/
# region-scale subsets retired once the app worked at national scale).
# buildings.parquet has no single combined file by design (region.py's
# own docstring) -- always a `parts/*.buildings.parquet` glob.
# exposure.parquet *does* have a single combined file
# (`region.combine_exposure`), regenerated whenever the crawl changes.
BUILDINGS_PATH = os.environ.get(
    "TWINER_BUILDINGS_PATH", f"{DATA_DIR}/exposure/parts/*.buildings.parquet"
)
EXPOSURE_PATH = os.environ.get("TWINER_EXPOSURE_PATH", f"{DATA_DIR}/exposure/exposure.parquet")
FRAGILITY_PATH = os.environ.get("TWINER_FRAGILITY_PATH", f"{DATA_DIR}/fragility/fragility.parquet")
FAULTS_PATH = os.environ.get("TWINER_FAULTS_PATH", f"{DATA_DIR}/faults/qafi_faults.parquet")
# The same static buildings.pmtiles the frontend already loads directly
# (apps/web's pmtilesUrl, via VITE_S3_DATA_BUCKET) -- tile_join.py reads individual
# tiles from it and joins in a scenario's results, never re-tiling.
BUILDINGS_PMTILES_PATH = os.environ.get(
    "TWINER_BUILDINGS_PMTILES_PATH", f"{DATA_DIR}/exposure/buildings.pmtiles"
)
# Same for debris.pmtiles (ADR-0010 rings) -- joined the same way, one tile
# at a time, by the /tiles/{scenario_id}/debris/... route below.
DEBRIS_PMTILES_PATH = os.environ.get(
    "TWINER_DEBRIS_PMTILES_PATH", f"{DATA_DIR}/exposure/debris.pmtiles"
)


DAMAGE_MODEL_HELP = (
    "How damage is calculated: `fragility` (fragility functions on an intensity measure) or "
    "`capacity_spectrum` (RISK-UE Level II). See GET /methods."
)
VULNERABILITY_DB_HELP = (
    "Where each building class's vulnerability data comes from: `gem` (Martins & Silva "
    "2021) or `risk_ue` (RISK-UE 2003, capacity curves only). See GET /methods."
)
CLASSIFICATION_HELP = (
    "How each building got its class in the database's taxonomy: `gem_heuristic` (for `gem`) "
    "or `risk_ue_feriche2012` (for `risk_ue`). Omit it for the database's default. "
    "See GET /methods."
)


class ManualRuptureRequest(BaseModel):
    # The API reference's example request: the 2011 Lorca earthquake.
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"lat": 37.699, "lon": -1.673, "mag": 5.2, "rake": 44, "probability_level": "low"}
            ]
        }
    )

    lat: float = Field(description="Epicentre latitude, degrees.", examples=[37.699])
    lon: float = Field(description="Epicentre longitude, degrees.", examples=[-1.673])
    mag: float = Field(description="Moment magnitude (Mw), 3.0 to 9.0.", examples=[5.2])
    rake: float = Field(
        default=0.0, description="Degrees: 0 strike-slip, 90 reverse, -90 normal.", examples=[44]
    )
    # Advanced/optional: only combine into a finite rupture surface when
    # all three are given (ADR-0008) -- otherwise a point source at
    # (lat, lon) with `rake`, same as leaving them out entirely.
    strike: float | None = Field(default=None, description="Degrees. See `ztor_km`.")
    dip: float | None = Field(default=None, description="Degrees. See `ztor_km`.")
    ztor_km: float | None = Field(
        default=None,
        description="Depth to the top of the rupture, km. With strike, dip and ztor_km all "
        "given, the rupture is a finite plane sized from the magnitude (Wells & Coppersmith "
        "1994); otherwise it's a point source.",
    )
    # MERISUR's probability-level selector (probability_level.py,
    # docs/merisur.md §4.7) -- defaults to "high" (median ground motion,
    # modal damage state), today's only pre-existing behaviour.
    probability_level: ProbabilityLevel = Field(
        default="high",
        description="`high`: median ground motion, most likely damage state. `low`: median + 1σ "
        "ground motion. `very_low`: median + 1σ and the 85th-percentile damage state.",
    )
    damage_model: str = Field(default=DEFAULT_DAMAGE_MODEL, description=DAMAGE_MODEL_HELP)
    vulnerability_db: str = Field(
        default=DEFAULT_VULNERABILITY_DB, description=VULNERABILITY_DB_HELP
    )
    classification: str | None = Field(default=None, description=CLASSIFICATION_HELP)


def _resolve_method(
    damage_model: str | None, vulnerability_db: str | None, classification: str | None = None
) -> DamageMethod:
    try:
        return resolve_damage_method(damage_model, vulnerability_db, classification)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _method_id_params(method: DamageMethod) -> dict | None:
    """What scenario ids hash for the method: nothing for the default."""
    return None if method.is_default else method.params()


def _validate_probability_level(probability_level: str) -> None:
    try:
        resolve_probability_level(probability_level)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _cached_response(scenario_id: str) -> dict | None:
    """A stored result for this content-addressed id (scenario_id.py), if
    the cache is on and one exists. Warms the tile pool for it the same way
    a fresh compute does, since the user's next move is fetching its
    tiles."""
    if not cache_enabled():
        return None
    t0 = time.monotonic()
    payload = read_response(scenario_id)
    if payload is None:
        return None
    for _ in range(_TILE_POOL_WORKERS):
        _TILE_POOL.submit(warm_cache, BUILDINGS_PMTILES_PATH, scenario_id)
    payload["cached"] = True
    payload["elapsed_ms"] = round((time.monotonic() - t0) * 1000, 1)
    print(f"scenario: cache hit {scenario_id} ({payload['rupture']['source']})")
    return payload


def _run_and_serialize(
    rupture: Rupture,
    probability_level: str,
    scenario_id: str,
    method: DamageMethod = DEFAULT_METHOD,
) -> dict:
    """Computes the scenario and stores it under `scenario_id` (content-
    addressed, scenario_id.py -- minted by the caller, which is also where
    the cache lookup happens, before any rupture is built)."""
    level_params = resolve_probability_level(probability_level)
    init_scenario(scenario_id)

    try:
        t0 = time.monotonic()
        # Computed here (not left to summarize_scenario's own default) so the
        # exact radius actually used for the spatial pre-filter is known
        # and can ride along in the response as `evaluated_region` --
        # that's what lets the frontend tell "never evaluated" (outside
        # this radius) apart from "evaluated, confidently undamaged"
        # (inside it, but not in `buildings` below) without a per-building
        # entry for either. Uses this same request's sigma_multiplier
        # (see estimate_significant_distance_km's docstring).
        radius_km = estimate_significant_distance_km(
            rupture, sigma_multiplier=level_params.sigma_multiplier
        )
        # Streamed and reduced batch by batch (engine.summarize_scenario),
        # never holding every evaluated building at once.
        summary = summarize_scenario(
            rupture,
            BUILDINGS_PATH,
            EXPOSURE_PATH,
            FRAGILITY_PATH,
            max_distance_km=radius_km,
            sigma_multiplier=level_params.sigma_multiplier,
            damage_percentile=level_params.damage_percentile,
            # Critical-infrastructure facilities' buildings (ADR-0025): kept
            # in full, so each facility reports its building's distribution.
            track_building_ids=facility_building_ids(),
            method=method,
        )
        n_evaluated = summary.n_evaluated
        n_damaged = summary.n_damaged
        # Counted over *every* evaluated building, not just the shipped ones.
        # Census-section impact figures (impact.py, ADR-0024), rolled up to
        # municipalities for the response; the section rows themselves
        # are fetched separately (/results/{id}/section_stats), since a
        # large scenario can damage tens of thousands of sections.
        municipality_stats = summary.areas.municipality_stats()
        write_municipality_stats(scenario_id, municipality_stats)
        write_section_stats(scenario_id, summary.areas.section_stats())
        # Damaged/uncertain buildings only, in the thin frontend-facing
        # shape (see response.py's docstring for why lon/lat/im_value/
        # im_type are dropped and damage_state becomes an int code).
        # Written for the tile joins (buildings + debris, ADR-0019), not
        # returned -- the frontend never needs the per-building list.
        write_buildings(scenario_id, stored_results_columns(summary.shipped))
        # Critical infrastructure + intensity bands (ADR-0025): after the
        # buildings, since facilities take their building's damage state.
        infrastructure, bands = summarize_infrastructure(
            rupture, radius_km, level_params.sigma_multiplier, summary.tracked
        )
        write_artifact(scenario_id, INTENSITY_FILE, bands)
        if infrastructure is not None:
            write_artifact(scenario_id, INFRASTRUCTURE_FILE, infrastructure)
        # Fire-and-forget: pays each pool worker's cold-cache cost for this
        # scenario now, in the background, rather than on the user's first
        # tile request (see warm_cache's own docstring for why this is
        # needed per scenario, not just once at process startup). One
        # submission per worker is a best-effort way to reach all of them --
        # ProcessPoolExecutor gives no direct "run on every worker" API,
        # but submitting exactly as many tasks as there are workers reaches
        # each one as long as they're otherwise idle, the common case
        # between scenario runs.
        for _ in range(_TILE_POOL_WORKERS):
            _TILE_POOL.submit(warm_cache, BUILDINGS_PMTILES_PATH, scenario_id)
        elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"missing pipeline output: {e}") from e

    print(
        f"scenario: {rupture.source} -> {n_evaluated} evaluated, "
        f"{summary.shipped.num_rows} sent (damaged or uncertain), "
        f"finite_rupture={rupture.surface is not None}, in {elapsed_ms}ms"
    )
    payload = {
        "scenario_id": scenario_id,
        "rupture": {
            "lat": rupture.lat,
            "lon": rupture.lon,
            "mag": rupture.mag,
            "source": rupture.source,
            # Whether ADR-0007's finite rupture plane was used (real Rjb)
            # vs. the point-source fallback -- surfaces the distinction
            # rather than hiding which approximation produced this result.
            "finite_rupture": rupture.surface is not None,
            # Echoes back which of the three tiers actually ran (see
            # ManualRuptureRequest/run_fault_scenario's own parameter) --
            # a caller that didn't specify one still sees "high" rather
            # than needing to remember the default.
            "probability_level": probability_level,
        },
        # Which damage model and vulnerability database ran (ADR-0033).
        "damage_method": method.params(),
        # See response.evaluated_region's docstring (centered on the
        # rupture's own point, widened to cover a finite surface's extent).
        "evaluated_region": evaluated_region(rupture, radius_km),
        "n_evaluated": n_evaluated,
        "n_damaged": n_damaged,
        "n_damaged_reported": summary.n_damaged_reported,
        "municipality_stats": municipality_stats,
        # Affected assets by category; null when no infrastructure data is
        # deployed (the rows: /results/{id}/infrastructure).
        "infrastructure_summary": (
            summarize_assets(infrastructure) if infrastructure is not None else None
        ),
    }
    # Stored (without the per-request fields added below) whether or not
    # the cache is on -- see results_store.py's docstring.
    write_response(scenario_id, payload)
    return {**payload, "cached": False, "elapsed_ms": elapsed_ms}


@app.post(
    "/scenarios/manual",
    tags=["Earthquake"],
    summary="Run a manual earthquake scenario",
    description="Simulates an earthquake you define: epicentre, magnitude and, optionally, the "
    "fault mechanism and rupture plane. Returns the scenario id and per-municipality damage "
    "and impact figures.",
    response_model=None,
    responses={**ok(api_models.EarthquakeScenarioResponse), **errors(400, 500)},
)
def run_manual_scenario(req: ManualRuptureRequest) -> dict:
    _validate_probability_level(req.probability_level)
    method = _resolve_method(req.damage_model, req.vulnerability_db, req.classification)
    scenario_id = manual_scenario_id(
        req.lat,
        req.lon,
        req.mag,
        req.rake,
        req.strike,
        req.dip,
        req.ztor_km,
        req.probability_level,
        method=_method_id_params(method),
    )
    if (cached := _cached_response(scenario_id)) is not None:
        return cached
    rupture = from_manual_input(
        lat=req.lat,
        lon=req.lon,
        mag=req.mag,
        rake=req.rake,
        strike=req.strike,
        dip=req.dip,
        ztor_km=req.ztor_km,
    )
    return _run_and_serialize(rupture, req.probability_level, scenario_id, method)


class FloodScenarioRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "return_period": 100,
                    "region": {"type": "admin", "level": "municipality", "code": "46250"},
                }
            ]
        }
    )

    return_period: int = Field(description="Years: 10, 50, 100 or 500.", examples=[100])
    # Validated by flood.parse_region (a 400, like handler.py), so it stays a
    # plain dict here; the schema below is for the API reference only.
    region: dict = Field(
        description="A circle, `{type: circle, lat, lon, radius_km}` with radius_km up to 200, "
        "or an administrative area, `{type: admin, level: ccaa | province | municipality, "
        "code}` with an INE code.",
        json_schema_extra=api_models.FLOOD_REGION_SCHEMA,
        examples=[{"type": "admin", "level": "municipality", "code": "46250"}],
    )


@app.post(
    "/scenarios/flood",
    tags=["Flood"],
    summary="Run a flood scenario",
    description="Buildings, residents and critical infrastructure inside MITECO's flood zone "
    "for one return period, in a circle (up to 200 km) or an administrative area.",
    response_model=None,
    responses={**ok(api_models.FloodScenarioResponse), **errors(400, 500)},
)
def flood_scenario(req: FloodScenarioRequest) -> dict:
    """Flood mode (ADR-0029): buildings, people and infrastructure in
    MITECO's flood zone for a return period, in a circle or admin area.
    Stored like a seismic scenario, so the sidebar's section drill-down and
    infrastructure list use the same /results/{id}/... routes."""
    try:
        return_period = validate_return_period(req.return_period)
        region = parse_region(req.region)
    except FloodRequestError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    scenario_id = flood_scenario_id(return_period, region_params(region))
    t0 = time.monotonic()
    if cache_enabled() and (payload := read_response(scenario_id)) is not None:
        return {**payload, "cached": True, "elapsed_ms": round((time.monotonic() - t0) * 1000, 1)}
    try:
        summary = summarize_flood(region, return_period)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"missing pipeline output: {e}") from e
    init_scenario(scenario_id)
    write_municipality_stats(scenario_id, summary.municipality_stats)
    write_section_stats(scenario_id, summary.section_stats)
    if summary.infrastructure is not None:
        write_artifact(scenario_id, INFRASTRUCTURE_FILE, summary.infrastructure)
    payload = flood_payload(scenario_id, region, return_period, summary)
    write_response(scenario_id, payload)
    elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
    print(
        f"scenario: flood T={return_period} {region_params(region)} -> "
        f"{summary.n_flooded} buildings flooded, in {elapsed_ms}ms"
    )
    return {**payload, "cached": False, "elapsed_ms": elapsed_ms}


@app.get(
    "/methods",
    tags=["Earthquake"],
    summary="List the damage models, vulnerability databases and classifications",
    description="Every damage model, vulnerability database and building classification "
    "scheme a scenario can use, what each needs and provides, and the valid combinations "
    "(`damage_model` + `vulnerability_db` + `classification` on the scenario routes).",
    response_model=None,
    responses=ok(api_models.MethodsResponse),
)
def list_methods() -> dict:
    return methods_payload()


@app.get(
    "/faults",
    tags=["Earthquake"],
    summary="List the active faults",
    description="Every QAFI v4 fault available to automatic mode, with its maximum magnitude, "
    "mechanism, seismogenic depth range and trace.",
    response_model=None,
    responses={**ok(api_models.FaultsResponse), **errors(500)},
)
def list_faults() -> dict:
    """Every fault in the dataset (QAFI v4 today: 201 nationwide), sorted by
    name -- feeds the frontend's "Automatic" fault picker and fault map
    layer (docs/merisur.md §4.1). No location/radius filtering: the whole
    set is small, and ordering it relative to the map view is the
    frontend's job (it already has every trace's geometry)."""
    try:
        return faults_payload(FAULTS_PATH)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"missing pipeline output: {e}") from e


@app.get(
    "/scenarios/fault",
    tags=["Earthquake"],
    summary="Run a fault's maximum-magnitude earthquake",
    description="Automatic mode: the maximum-magnitude earthquake of one QAFI fault, rupturing "
    "its whole modelled plane. A GET, so the result is cacheable by URL. `near_lat`/`near_lon` "
    "only matter for a fault without rupture geometry (none in QAFI v4 today).",
    response_model=None,
    responses={**ok(api_models.EarthquakeScenarioResponse), **errors(404, 500)},
)
def run_fault_scenario(
    fault_id: Annotated[
        str, Query(description="QAFI fault id, from GET /faults.", examples=["ES626"])
    ],
    probability_level: ProbabilityLevel = "high",
    near_lat: float | None = None,
    near_lon: float | None = None,
    damage_model: Annotated[str, Query(description=DAMAGE_MODEL_HELP)] = DEFAULT_DAMAGE_MODEL,
    vulnerability_db: Annotated[
        str, Query(description=VULNERABILITY_DB_HELP)
    ] = DEFAULT_VULNERABILITY_DB,
    classification: Annotated[str | None, Query(description=CLASSIFICATION_HELP)] = None,
) -> dict:
    """Automatic mode (docs/merisur.md §4.1): a QAFI fault's own
    maximum-magnitude earthquake. A GET, not a POST: `fault_id` and
    `probability_level` fully determine the result for any fault with a
    full rupture geometry in QAFI (all of QAFI v4's) -- mmax/geometry/dip/
    rake all come from QAFI, and the rupture's location comes from its own
    trace (faults.py's `rupture_anchor`). That makes it cacheable by URL.

    `near_lat`/`near_lon` are optional and only used for a fault *without*
    that geometry (`has_rupture_geometry` false in /faults), which falls
    back to a point source at the trace point closest to them. Ignored --
    and left out of the scenario_id -- for every other fault.
    """
    near_lat, near_lon = round_near_point(near_lat, near_lon)
    try:
        fault = get_fault(FAULTS_PATH, fault_id, near_lat, near_lon)
        anchor_lat, anchor_lon, near_used = rupture_anchor(fault)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"missing pipeline output: {e}") from e
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    method = _resolve_method(damage_model, vulnerability_db, classification)
    scenario_id = fault_scenario_id(
        fault_id,
        probability_level,
        near_lat if near_used else None,
        near_lon if near_used else None,
        method=_method_id_params(method),
    )
    if (cached := _cached_response(scenario_id)) is not None:
        return cached

    rupture = from_fault(
        fault_id=fault["fault_id"],
        name=fault["name"],
        point_lat=anchor_lat,
        point_lon=anchor_lon,
        mmax=fault["mmax"],
        rake=fault["rake"],
        geometry_geojson=fault["geometry_geojson"],
        dip=fault["dip"],
        min_depth_km=fault["min_depth_km"],
        max_depth_km=fault["max_depth_km"],
    )
    return _run_and_serialize(rupture, probability_level, scenario_id, method)


@app.get(
    "/buildings/{building_id}",
    tags=["Exposure"],
    summary="Get a building's vulnerability class",
    description="The vulnerability (taxonomy) and height class assigned to one cadastral "
    "building. Its footprint, floors, year and use are in the buildings vector tiles.",
    response_model=None,
    responses={**ok(api_models.Building), **errors(404, 500)},
)
def building_info(building_id: str) -> dict:
    """Static exposure attributes for one building -- powers the
    frontend's building-click popup. Floors/construction year/use are
    already on the clicked PMTiles feature client-side; this only needs to
    cover what isn't baked into the tiles (taxonomy_class/height_class,
    see building_lookup.py)."""
    try:
        row = get_building(EXPOSURE_PATH, building_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=f"missing pipeline output: {e}") from e
    if row is None:
        raise HTTPException(status_code=404, detail=f"building_id {building_id!r} not found")
    return row.to_dict()


@app.get(
    "/results/{scenario_id}/status",
    tags=["Results"],
    summary="Get a scenario's layer readiness",
    description="Which of a scenario's outputs are ready. Scenarios currently compute "
    "synchronously, so every flag is true once the scenario call has returned. Local server only.",
    response_model=None,
    responses={**ok(api_models.ScenarioStatus), **errors(404)},
)
def scenario_status(scenario_id: str) -> dict:
    """Per-layer readiness for a scenario run, keyed by the `scenario_id`
    the /scenarios/* routes return. Compute is still synchronous today (see
    results_store.py's docstring), so by the time a client can call this
    the run has already finished and every flag reads true -- this is
    scaffolding for the async job flow (poll while compute runs) that's the
    intended next step, kept working now so the frontend's legend loading
    indicators can be built against a stable contract before that lands."""
    status = read_status(scenario_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"scenario_id {scenario_id!r} not found")
    return status


@app.get(
    "/results/{scenario_id}/municipality_stats",
    tags=["Results"],
    summary="Get per-municipality figures",
    description="The same per-municipality rows the scenario call returned. Local server only.",
    response_model=None,
    responses={
        **ok(list[api_models.SeismicMunicipalityStats] | list[api_models.FloodMunicipalityStats]),
        **errors(404),
    },
)
def scenario_municipality_stats(scenario_id: str) -> list[dict]:
    stats = read_municipality_stats(scenario_id)
    if stats is None:
        raise HTTPException(status_code=404, detail=f"scenario_id {scenario_id!r} not found")
    return stats


@app.get(
    "/results/{scenario_id}/section_stats",
    tags=["Results"],
    summary="Get per-census-section figures",
    description="Impact figures for every affected INE census section, or only one "
    "municipality's with `municipality_code`. Earthquake rows carry damage counts and "
    "cost/debris estimates; flood rows carry buildings, residents and area in the flood zone.",
    response_model=None,
    responses={
        **ok(list[api_models.SeismicSectionStats] | list[api_models.FloodSectionStats]),
        **errors(404),
    },
)
def scenario_section_stats(scenario_id: str, municipality_code: str | None = None) -> list[dict]:
    """Damaged census sections' impact rows, optionally just one
    municipality's (the sidebar's drill-down)."""
    stats = read_section_stats(scenario_id)
    if stats is None:
        raise HTTPException(status_code=404, detail=f"scenario_id {scenario_id!r} not found")
    if municipality_code is not None:
        stats = [s for s in stats if s["municipality_code"] == municipality_code]
    return stats


@app.get(
    "/results/{scenario_id}/section_severity",
    tags=["Results"],
    summary="Get the census-section choropleth values",
    description="Census section code to one number per section: the mean damage state (0 None "
    "to 4 Complete) for an earthquake, or the % of buildings in the flood zone for a flood.",
    response_model=None,
    responses={**ok(dict[str, float]), **errors(404)},
)
def scenario_section_severity(scenario_id: str) -> dict[str, float]:
    """section_code -> the choropleth value (impact.section_severity) for
    every affected section: all the map's section choropleth needs, a
    small fraction of the full rows' size."""
    stats = read_section_stats(scenario_id)
    if stats is None:
        raise HTTPException(status_code=404, detail=f"scenario_id {scenario_id!r} not found")
    return section_severity(stats)


@app.get(
    "/results/{scenario_id}/infrastructure",
    tags=["Results"],
    summary="Get affected critical infrastructure",
    description="Hospitals, schools, care homes, emergency services, power facilities, bridges "
    "and dams affected by the scenario, most intense first. For an earthquake: assets at "
    "estimated intensity VI or more, plus facilities whose building was damaged. For a flood: "
    "assets inside the flood zone.",
    response_model=None,
    responses={**ok(list[api_models.InfrastructureAsset]), **errors(404)},
)
def scenario_infrastructure(scenario_id: str, municipality_code: str | None = None) -> list[dict]:
    """Affected critical-infrastructure assets (ADR-0025), most intense
    first: all of them (the map colours them), or one municipality's (the
    sidebar)."""
    rows = read_artifact(scenario_id, INFRASTRUCTURE_FILE)
    if rows is None:
        raise HTTPException(status_code=404, detail=f"no infrastructure for {scenario_id!r}")
    assert isinstance(rows, list)
    if municipality_code is not None:
        rows = [r for r in rows if r["municipality_code"] == municipality_code]
    return rows


@app.get(
    "/results/{scenario_id}/intensity",
    tags=["Results"],
    summary="Get the intensity bands",
    description="Contours of estimated macroseismic intensity (EMS-98) as GeoJSON. "
    "Earthquake scenarios only.",
    response_model=None,
    responses={**ok(api_models.IntensityBands), **errors(404)},
)
def scenario_intensity(scenario_id: str) -> dict:
    """Intensity bands GeoJSON (ADR-0025) -- the map's bands layer."""
    bands = read_artifact(scenario_id, INTENSITY_FILE)
    if bands is None:
        raise HTTPException(status_code=404, detail=f"no intensity for {scenario_id!r}")
    assert isinstance(bands, dict)
    return bands


@app.get(
    "/tiles/{scenario_id}/{z}/{x}/{y}.mvt",
    tags=["Tiles"],
    summary="Get a buildings tile with scenario results",
    description="A Mapbox Vector Tile of building footprints, each carrying this scenario's "
    "damage state and probabilities when it has one. 204 for an empty tile. Served by a "
    "separate tiles function in the cloud deployment.",
    response_class=Response,
    responses={
        200: {"content": {"application/vnd.mapbox-vector-tile": {}}, "description": "Tile"},
        204: {"description": "No buildings in this tile."},
        **errors(404),
    },
)
async def scenario_tile(scenario_id: str, z: int, x: int, y: int) -> Response:
    """A buildings vector tile with each feature's properties extended by
    this scenario's result for its `building_id`, when present -- lets the
    frontend drive a MapLibre vector source straight off scenario results
    instead of fetching every affected building_id and setFeatureState-ing
    them in one by one (see tile_join.py's docstring for the full design
    rationale, including why this reads one tile at a time rather than
    building a per-scenario buildings.pmtiles)."""
    return await _joined_tile(BUILDINGS_PMTILES_PATH, scenario_id, z, x, y, debris=False)


@app.get(
    "/tiles/{scenario_id}/debris/{z}/{x}/{y}.mvt",
    tags=["Tiles"],
    summary="Get a debris tile",
    description="A Mapbox Vector Tile of the debris envelopes (the area around each damaged "
    "building that rubble may reach) for this scenario's damaged buildings.",
    response_class=Response,
    responses={
        200: {"content": {"application/vnd.mapbox-vector-tile": {}}, "description": "Tile"},
        204: {"description": "No debris in this tile."},
        **errors(404),
    },
)
async def scenario_debris_tile(scenario_id: str, z: int, x: int, y: int) -> Response:
    """A debris.pmtiles tile cut down to this scenario's damaged buildings'
    matching rings (ADR-0019) -- the debris counterpart of `scenario_tile`,
    so the frontend never needs the per-building result list itself."""
    return await _joined_tile(DEBRIS_PMTILES_PATH, scenario_id, z, x, y, debris=True)


async def _joined_tile(
    pmtiles_path: str, scenario_id: str, z: int, x: int, y: int, debris: bool
) -> Response:
    """Dispatched to `_TILE_POOL` (see its own comment) rather than called
    directly -- join_tile is CPU-bound, and running it in-process would
    serialize concurrent tile requests behind the GIL."""
    loop = asyncio.get_running_loop()
    try:
        tile = await loop.run_in_executor(
            _TILE_POOL, join_tile, pmtiles_path, scenario_id, z, x, y, debris
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    if tile is None:
        # No base-tile data at this z/x/y (e.g. open ocean) -- a 204, not a
        # 404: the scenario_id is valid, this tile is just legitimately
        # empty, same as the static archive itself would return.
        return Response(status_code=204)
    return Response(content=tile, media_type="application/vnd.mapbox-vector-tile")


@app.get(
    "/realtime/dgt-incidents",
    tags=["Real time"],
    summary="Get current traffic incidents",
    description="Active incidents from the DGT, Servei Català de Trànsit and Trafikoa DATEX II "
    "feeds, as GeoJSON.",
    response_model=None,
    responses={**ok(api_models.TrafficIncidents), **errors(503)},
)
def realtime_dgt_incidents() -> dict:
    """ADR-0026: active DGT traffic incidents, as GeoJSON."""
    try:
        return dgt_incidents()
    except RealtimeUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get(
    "/realtime/aemet-observations",
    tags=["Real time"],
    summary="Get latest weather observations",
    description="Each AEMET automatic station's latest hourly reading, as GeoJSON.",
    response_model=None,
    responses={**ok(api_models.WeatherObservations), **errors(503)},
)
def realtime_aemet_observations() -> dict:
    """ADR-0026: each AEMET station's latest reading, as GeoJSON."""
    try:
        return aemet_observations()
    except RealtimeUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get(
    "/realtime/aemet-warnings",
    tags=["Real time"],
    summary="Get weather warnings",
    description="AEMET's current and upcoming Meteoalerta warnings, as GeoJSON polygons.",
    response_model=None,
    responses={**ok(api_models.WeatherWarnings), **errors(503)},
)
def realtime_aemet_warnings() -> dict:
    """ADR-0026: AEMET's current and upcoming weather warnings, as GeoJSON."""
    try:
        return aemet_warnings()
    except RealtimeUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get(
    "/warmup",
    tags=["Operations"],
    summary="Warm up the scenario function",
    description="Loads data and compiled code ahead of the first scenario. The web app calls it "
    "on page load.",
    response_model=None,
    responses=ok(api_models.Warmup),
)
def warmup() -> dict:
    """See warmup.py: the frontend's fire-and-forget call on page load."""
    return warm_up(BUILDINGS_PATH, EXPOSURE_PATH)


@app.get(
    "/health",
    tags=["Operations"],
    summary="Health check",
    response_model=None,
    responses=ok(api_models.Health),
)
def health() -> dict:
    return {"status": "ok"}
