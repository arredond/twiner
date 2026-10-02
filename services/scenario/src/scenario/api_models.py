"""Response shapes for the published API reference (apps/docs, /docs/api/).

Documentation only: local.py attaches these through `responses=`, never
`response_model=`, so FastAPI doesn't validate or filter what the routes
return (handler.py builds the same payloads as plain dicts, and filtering
would let the two drift silently). test_api_models.py checks real payloads
against them instead. Regenerate the docs' openapi.json with
bin/export-openapi after changing anything here or in a route's metadata.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DamageStateName = Literal["None", "Slight", "Moderate", "Extensive", "Complete"]


API_DESCRIPTION = """\
The HTTP API behind the TWIN-ER web app: run earthquake and flood scenarios,
then read their results by area, as map tiles, or as GeoJSON.

## How it fits together

1. **Run a scenario.** `GET /scenarios/fault` (a fault's maximum-magnitude
   earthquake), `POST /scenarios/manual` (an earthquake you define) or
   `POST /scenarios/flood`. The response has a `scenario_id` and one row of
   figures per affected municipality.
2. **Read the details** with that id: per-census-section figures, affected
   critical infrastructure, intensity bands (`/results/{scenario_id}/...`),
   and building/debris vector tiles (`/tiles/{scenario_id}/...`).

Scenario ids are content-addressed: the same inputs on the same data and
code version give the same id, so results can be cached and shared.

## Deployments

- **Local** (`bin/twiner start`): every route below, on one server.
- **Cloud** (AWS Lambda function URLs): the scenario function serves every
  route except `/tiles/...`, which a separate tiles function serves, and the
  two local-only routes `/results/{scenario_id}/status` and
  `/results/{scenario_id}/municipality_stats`.

There is no authentication, versioning guarantee or rate limit yet: this
reference describes the API the web app uses, not a stable public contract.

## Errors

The local server answers errors as `{"detail": "..."}`; the Lambda as
`{"error": "..."}`.

See the [twinQUAKE](/docs/hazards/earthquake/) and
[twinFLOOD](/docs/hazards/flood/) pages for what the numbers mean.
"""

OPENAPI_TAGS = [
    {"name": "Earthquake", "description": "twinQUAKE: faults and earthquake scenarios."},
    {"name": "Flood", "description": "twinFLOOD: flood-zone scenarios."},
    {"name": "Results", "description": "A scenario's outputs, by its `scenario_id`."},
    {"name": "Tiles", "description": "Vector tiles joined with a scenario's results."},
    {"name": "Exposure", "description": "Static attributes of the building stock."},
    {"name": "Real time", "description": "Live traffic and weather layers (proxied)."},
    {"name": "Operations", "description": "Health and warm-up."},
]


class _Model(BaseModel):
    # Payloads may carry fields not listed here yet; the reference documents
    # what a client can rely on, not an exhaustive whitelist.
    model_config = ConfigDict(extra="allow")


# --- Errors -----------------------------------------------------------------


class Error(_Model):
    """Local server shape. The AWS Lambda answers `{"error": "..."}` instead."""

    detail: str = Field(description="What went wrong.")


# --- Faults -----------------------------------------------------------------


class Fault(_Model):
    fault_id: str = Field(description="QAFI v4 fault id, e.g. `ES626`.", examples=["ES626"])
    name: str = Field(examples=["Alhama de Murcia (1/4)"])
    mmax: float = Field(description="Maximum moment magnitude (Mw) used in automatic mode.")
    mmax_source: Literal["qafi_v4_published", "estimated_wells_coppersmith_1994"] = Field(
        description="Literature value published in QAFI, or estimated from trace length "
        "with Wells & Coppersmith (1994)."
    )
    length_km: float
    rake: float | None = Field(description="Degrees, Aki & Richards convention.")
    dip: float | None = Field(description="Degrees.")
    min_depth_km: float | None = Field(description="Top of the seismogenic layer.")
    max_depth_km: float | None = Field(description="Bottom of the seismogenic layer.")
    has_rupture_geometry: bool = Field(
        description="Whether QAFI gives the dip and depth range needed for a finite rupture "
        "plane (true for every QAFI v4 fault)."
    )
    geometry_geojson: str = Field(
        description="The fault trace as a GeoJSON (Multi)LineString, serialised as a string."
    )


class FaultsResponse(_Model):
    faults: list[Fault] = Field(description="Every fault, sorted by name.")


# --- Earthquake scenarios ---------------------------------------------------


class Rupture(_Model):
    lat: float = Field(description="Rupture point: the epicentre, or the fault trace's midpoint.")
    lon: float
    mag: float = Field(description="Moment magnitude (Mw).")
    source: str = Field(
        description="`manual`, or `fault:<fault_id>:<name>` in automatic mode.",
        examples=["fault:ES626:Alhama de Murcia (1/4)"],
    )
    finite_rupture: bool = Field(
        description="True when distances were measured to a finite rupture plane, false for "
        "the point-source approximation."
    )
    probability_level: Literal["high", "low", "very_low"]


class EvaluatedRegion(_Model):
    """The circle the scenario searched. Buildings outside it were not
    evaluated, which is different from evaluated and undamaged."""

    lat: float
    lon: float
    radius_km: float


class DamageCounts(_Model):
    """Expected buildings per damage state: each building's probability of
    being in each state, summed over the area."""

    None_: float = Field(alias="None")
    Slight: float
    Moderate: float
    Extensive: float
    Complete: float


class ReportedDamageCounts(_Model):
    """Buildings per reported damage state: the single state each building
    gets at the chosen probability level, as the map colours it."""

    None_: int = Field(alias="None")
    Slight: int
    Moderate: int
    Extensive: int
    Complete: int


class SeismicImpact(_Model):
    """Impact figures for one area (municipality or census section) after an
    earthquake. See /docs/impact-estimates/ for how each is computed.

    Damage counts and every figure derived from them are expected values:
    each building's probability of being in each state, summed. Areas with
    less than half an expected damaged building and no building reported
    damaged count as undamaged; such municipalities carry only
    `municipality_code`, `n_evaluated`, `n_damaged`, `counts` and
    `counts_reported`, to keep large responses small."""

    name: str | None = None
    bbox: list[float] | None = Field(
        default=None, description="[west, south, east, north], degrees."
    )
    n_evaluated: int = Field(description="Buildings the scenario evaluated.")
    n_damaged: float = Field(
        description="Expected buildings in any state other than None (summed probabilities)."
    )
    counts: DamageCounts
    counts_reported: ReportedDamageCounts | None = None
    n_buildings: int | None = Field(
        default=None, description="All buildings in the area, evaluated or not."
    )
    pct_buildings_affected: float | None = Field(
        default=None, description="n_damaged / n_buildings, in % (expected)."
    )
    population: int | None = Field(default=None, description="Residents, INE 1 January 2025.")
    vulnerable_population: int | None = Field(
        default=None, description="Residents under 15 or aged 65 and over."
    )
    affected_population: int | None = None
    pct_population_affected: float | None = None
    affected_vulnerable_population: int | None = None
    pct_vulnerable_affected: float | None = None
    displaced_population: int | None = Field(
        default=None, description="Residents of Extensive or Complete buildings."
    )
    cost_meur: float | None = Field(
        default=None, description="Material repair cost, millions of euros."
    )
    debris_t: int | None = Field(default=None, description="Debris weight, tonnes.")
    truck_rotations: int | None = Field(
        default=None, description="20-tonne truck trips to remove the debris."
    )
    shoring_props: int | None = Field(default=None, description="Shoring props (puntales) needed.")


class SeismicMunicipalityStats(SeismicImpact):
    municipality_code: str = Field(description="INE 5-digit municipality code.", examples=["30024"])


class SeismicSectionStats(SeismicImpact):
    section_code: str = Field(description="INE 10-digit census section code.")
    municipality_code: str


class InfrastructureSummary(_Model):
    """Affected assets per category. Categories with none are omitted."""

    health: int | None = None
    education: int | None = None
    care: int | None = None
    emergency: int | None = None
    power: int | None = None
    bridge: int | None = None
    dam: int | None = None


class DamageMethodParams(_Model):
    """The damage model, vulnerability database and classification scheme
    a scenario ran with."""

    damage_model: str = Field(examples=["fragility", "capacity_spectrum"])
    vulnerability_db: str = Field(examples=["gem", "risk_ue"])
    classification: str = Field(examples=["gem_heuristic", "risk_ue_feriche2012"])


class DamageModelInfo(_Model):
    id: str
    name: str
    needs: str = Field(description="The kind of vulnerability data it needs.")
    hazard_inputs: list[str]
    exposure_inputs: list[str]
    output: str
    reference: str


class VulnerabilityDatabaseInfo(_Model):
    id: str
    name: str
    taxonomy: str = Field(description="The class system its data is keyed by.")
    provides: list[str] = Field(description="The kinds of vulnerability data it provides.")
    classes: str = Field(description="The classes it has vulnerability data for.")
    derivation: str = Field(description="How the database's vulnerability data was derived.")
    damage_criteria: str = Field(
        description="With the capacity-spectrum model: how damage-state thresholds are set on "
        "each capacity curve."
    )
    source: str
    licence: str


class ClassificationInfo(_Model):
    id: str
    name: str
    taxonomy: str = Field(description="The taxonomy it classifies buildings into.")
    requires: list[str] = Field(description="The building and site attributes it uses.")
    method: str = Field(description="How a building's class is assigned.")
    reference: str
    default_for_taxonomy: bool = Field(
        description="Whether it's used when a scenario names the database but no classification."
    )


class MethodsResponse(_Model):
    default: DamageMethodParams
    damage_models: list[DamageModelInfo]
    vulnerability_databases: list[VulnerabilityDatabaseInfo]
    classifications: list[ClassificationInfo]
    compatible: list[DamageMethodParams] = Field(
        description="The valid combinations: a database must provide the data the model needs, "
        "and a classification must give classes in the database's taxonomy."
    )


class EarthquakeScenarioResponse(_Model):
    scenario_id: str = Field(
        description="Content-addressed id: the same inputs always give the same id. Use it "
        "with the /results/{scenario_id}/... and /tiles/{scenario_id}/... routes."
    )
    rupture: Rupture
    damage_method: DamageMethodParams
    evaluated_region: EvaluatedRegion
    n_evaluated: int
    n_damaged: float = Field(description="Expected damaged buildings (summed probabilities).")
    n_damaged_reported: int | None = Field(
        default=None, description="Buildings whose reported state isn't None."
    )
    municipality_stats: list[SeismicMunicipalityStats] = Field(
        description="Every municipality with at least one evaluated building."
    )
    infrastructure_summary: InfrastructureSummary | None = Field(
        description="Null when no infrastructure data is deployed."
    )
    cached: bool = Field(description="Whether the result came from the result cache.")
    elapsed_ms: float | None = Field(
        default=None, description="Server-side time. Local server only."
    )


# --- Flood scenarios --------------------------------------------------------


class CircleRegion(_Model):
    type: Literal["circle"]
    lat: float
    lon: float
    radius_km: float = Field(gt=0, le=200)


class AdminRegion(_Model):
    type: Literal["admin"]
    level: Literal["ccaa", "province", "municipality"]
    code: str = Field(
        description="INE code: 2 digits for a CCAA or province, 5 for a municipality.",
        examples=["46250"],
    )


# local.py's request model keeps `region` a plain dict (flood.parse_region
# validates it); this documents its two shapes in the reference.
FLOOD_REGION_SCHEMA: dict[str, Any] = {
    "oneOf": [
        CircleRegion.model_json_schema(),
        AdminRegion.model_json_schema(),
    ]
}


class FloodImpact(_Model):
    """Flood figures for one area. A building counts when its footprint
    intersects the flood zone."""

    name: str
    bbox: list[float] = Field(description="[west, south, east, north], degrees.")
    n_flooded: int = Field(description="Buildings in the flood zone.")
    n_buildings: int
    pct_buildings_flooded: float
    flooded_dwellings: int
    population: int
    affected_population: int = Field(description="Residents in the flood zone (estimated).")
    pct_population_affected: float
    vulnerable_population: int
    affected_vulnerable_population: int
    pct_vulnerable_affected: float
    flooded_area_km2: float = Field(description="Flood-zone area inside the area (and circle).")


class FloodMunicipalityStats(FloodImpact):
    municipality_code: str


class FloodSectionStats(FloodImpact):
    section_code: str
    municipality_code: str


class FloodParams(_Model):
    return_period: int
    region: CircleRegion | AdminRegion
    unmapped_provinces: list[str] = Field(
        description="Provinces in the region with no map at this return period (Canarias has "
        "no T10/T50). Not mapped is not the same as not flooded."
    )


class FloodTotals(_Model):
    n_flooded: int
    flooded_dwellings: int
    affected_population: int
    affected_vulnerable_population: int
    flooded_area_km2: float
    n_municipalities: int
    n_sections: int


class FloodScenarioResponse(_Model):
    scenario_id: str
    hazard: Literal["flood"]
    flood: FloodParams
    region_bbox: list[float] | None = Field(description="[west, south, east, north], degrees.")
    n_flooded: int
    totals: FloodTotals
    municipality_stats: list[FloodMunicipalityStats]
    infrastructure_summary: InfrastructureSummary | None
    cached: bool
    elapsed_ms: float | None = None


# --- Results ----------------------------------------------------------------


class ScenarioStatus(_Model):
    municipal_stats_ready: bool
    buildings_ready: bool
    debris_ready: bool
    updated_at: float = Field(description="Unix time, seconds.")


class InfrastructureAsset(_Model):
    asset_id: int
    category: Literal["health", "education", "care", "emergency", "power", "bridge", "dam"]
    subtype: str = Field(examples=["hospital", "school", "substation", "bridge"])
    name: str | None
    municipality_code: str
    lon: float
    lat: float
    intensity: float | None = Field(
        default=None,
        description="Estimated macroseismic intensity (EMS-98) at the asset. Earthquakes only.",
    )
    damage_state_code: int | None = Field(
        default=None,
        description="0 None to 4 Complete, for facilities in an evaluated building; null "
        "otherwise. Earthquakes only.",
    )
    damage_probs: list[float] | None = Field(
        default=None,
        description="Probability of each damage state, None to Complete. Earthquakes only.",
    )


class IntensityBands(_Model):
    """GeoJSON FeatureCollection, one (Multi)Polygon per integer intensity
    level from IV up, in `properties.intensity`."""

    type: Literal["FeatureCollection"]
    features: list[dict[str, Any]]
    cell_km: float = Field(description="Grid resolution the bands were contoured from.")


class Building(_Model):
    building_id: str = Field(examples=["000100100XG17C"])
    taxonomy_class: Literal["CR_LDUAL-DUL", "MUR_LWAL-DNO", "MUR-STRUB_LWAL-DNO"]
    height_class: int = Field(description="Storeys, 1 to 12.")
    taxonomy_source: str = Field(
        description="How the class was assigned (`heuristic_v2`: from construction year and floors)."
    )


# --- Real time --------------------------------------------------------------


class GeoJSONFeatureCollection(_Model):
    type: Literal["FeatureCollection"]
    features: list[dict[str, Any]]


class TrafficIncidents(GeoJSONFeatureCollection):
    """Point/line features with `source` (DGT, SCT, DT-GV), `category`,
    `road`, `km_from`/`km_to`, `start_time`/`end_time` and more."""

    published: str | None
    sources: dict[str, str] = Field(description="Status of each upstream feed.")


class WeatherObservations(GeoJSONFeatureCollection):
    """One point per AEMET station: `ta` temperature (°C), `hr` humidity (%),
    `prec` precipitation (mm), `vv`/`vmax` wind speed (m/s), `dv` wind
    direction (°), `pres` pressure (hPa)."""

    observed: str | None


class WeatherWarnings(GeoJSONFeatureCollection):
    """One polygon per warning zone: `level` (yellow, orange, red),
    `phenomenon`, `event_es`/`event_en`, `onset`, `expires`."""

    issued: str | None


class Health(_Model):
    status: Literal["ok"]


class Warmup(_Model):
    status: str
    already_warm: bool
    seconds: float
    numba_cache_files_written: int | None


def ok(model: Any, description: str = "Successful response") -> dict:
    """`responses=` entry documenting a route's 200 body without making
    FastAPI validate or filter it (see the module docstring)."""
    return {200: {"model": model, "description": description}}


def errors(*codes: int) -> dict:
    meanings = {
        400: "Invalid parameters.",
        404: "Not found.",
        500: "A pipeline output is missing on the server.",
        503: "The upstream real-time feed is unavailable.",
    }
    return {code: {"model": Error, "description": meanings[code]} for code in codes}
