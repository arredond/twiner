"""Post-event impact estimates per census section and municipality:
affected/displaced population, material cost, debris, truck rotations and
shoring props (ADR-0024). **Rough, documented placeholders**, not a
calibrated loss model -- every constant below is explained, with its
source, in docs/impact-estimates.md. Change one there and here together.

How it's computed: as a scenario's buildings stream through
(engine.summarize_scenario), `ImpactCounter` sums, per census section and
damage state, three things about the evaluated buildings: how many there
are, their dwellings, and their built floor area. Everything reported is
derived from those sums plus each section's static census figures
(`AreaMeta`, from pipelines/exposure's census_sections.py):

- Population is spread over a section's buildings in proportion to their
  dwellings (a section's residents are INE's; which buildings they live in
  isn't published). Affected residents = population x damaged dwellings /
  all dwellings in the section.
- Vulnerable/dependent residents (under 15 or 65+) are assumed to be spread
  like everyone else in their section.
- Cost, debris and shoring scale with built floor area (m2) in each damage
  state.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

import numpy as np
import pyarrow as pa

from .damage import DAMAGE_STATES

# --- Placeholder constants (docs/impact-estimates.md) ----------------------
# Indexed like DAMAGE_STATES: None, Slight, Moderate, Extensive, Complete.

# Replacement cost of built floor area, EUR/m2 (a round-number assumption,
# not from a published Spanish reference -- see docs/impact-estimates.md).
REPLACEMENT_COST_EUR_PER_M2 = 1_000.0
# Repair cost as a fraction of replacement cost: HAZUS-MH 2.1 Tables
# 15.2-15.4 (structural + acceleration- and drift-sensitive nonstructural),
# summed, residential RES1/RES3 averaged.
DAMAGE_RATIO = (0.0, 0.02, 0.10, 0.43, 1.00)

# Weight of a building, tonnes per m2 of built area, and the fraction of it
# that becomes debris per damage state: HAZUS-MH 2.1 Tables 12.1-12.3,
# averaged over the two model types closest to this stock (C3, concrete
# frame with masonry infill: 1.17 t/m2; URM, unreinforced masonry: 0.88).
DEBRIS_T_PER_M2 = 1.1
DEBRIS_FRACTION = (0.0, 0.02, 0.10, 0.38, 1.00)

# Payload per dump-truck trip, tonnes.
TRUCK_PAYLOAD_T = 20.0

# Share of built area needing emergency shoring, per damage state -- none
# for Complete (demolished, not propped) -- and props per shored m2.
SHORING_SHARE = (0.0, 0.0, 0.05, 0.20, 0.0)
PROPS_PER_SHORED_M2 = 1.0

# Damage states whose residents count as displaced (building unusable).
DISPLACED_STATES = ("Extensive", "Complete")

# ---------------------------------------------------------------------------

_N_STATES = len(DAMAGE_STATES)
_DISPLACED_MASK = np.array([s in DISPLACED_STATES for s in DAMAGE_STATES])
_COST_EUR_PER_M2 = REPLACEMENT_COST_EUR_PER_M2 * np.array(DAMAGE_RATIO)
_DEBRIS_T_PER_M2 = DEBRIS_T_PER_M2 * np.array(DEBRIS_FRACTION)
_PROPS_PER_M2 = PROPS_PER_SHORED_M2 * np.array(SHORING_SHARE)

# Buildings with no census section (a dataset built before sections existed,
# or a building the pipeline couldn't place) are still counted, under this
# prefix + their municipality code, so municipality totals stay whole.
_NO_SECTION_PREFIX = "m:"

# Catastro's ATOM feed doesn't always file a municipality under its real
# INE code (Madrid: 28900, not INE 28079 -- pipelines/exposure/catastro.py's
# own docstring). Ceuta/Melilla are a confirmed case: Catastro lists them as
# "territorial offices" 55/56, not INE province codes 51/52, so buildings
# there carry `municipality_code` "55101"/"56101" (pipeline.build_exposure
# stamps Catastro's own code) while
# `municipalities.pmtiles`/`municipalities.parquet` (sourced from IGN, keyed
# by real INE codes -- pipelines/exposure/municipalities.py) expect
# "51001"/"52001". Without this remap, DamageMap.tsx's join
# (`stats.municipality_code === tile's ine_code`, see its own comments)
# silently fails for these two, and a scenario there would never highlight
# them on the low-zoom choropleth. Only needed for buildings with no census
# section (sections carry real INE codes already). Kept in sync by hand with
# `pipelines/exposure/municipalities.py`'s own `_CATASTRO_CODE_TO_INE` --
# same two confirmed entries, not a general translator (see that module's
# comment for why one wasn't built).
_CATASTRO_CODE_TO_INE = {
    "55101": "51001",  # Ceuta
    "56101": "52001",  # Melilla
}

CENSUS_DIR = os.environ.get("TWINER_CENSUS_DIR", "data/census")


@dataclass
class AreaMeta:
    """Static census figures, per section and per municipality (see
    pipelines/exposure/census_sections.py). Empty when the census dataset
    isn't available: counts, cost and debris still work, population
    figures come out as 0."""

    sections: dict[str, dict] = field(default_factory=dict)
    municipalities: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, census_dir: str = CENSUS_DIR) -> AreaMeta:
        """Local paths or `s3://` (the deployed stack), through the same
        shared DuckDB + httpfs every other S3 read in this service uses."""
        import duckdb

        from .db import ensure_httpfs, get_connection

        con = get_connection()
        if census_dir.startswith("s3://"):
            ensure_httpfs(con)

        def read(name: str) -> list[dict]:
            result = con.execute("SELECT * FROM read_parquet(?)", [f"{census_dir}/{name}"])
            return result.arrow().read_all().to_pylist()

        try:
            sections = read("sections_meta.parquet")
            municipalities = read("municipalities_meta.parquet")
        except duckdb.IOException:
            return cls()
        return cls(
            sections={row["code"]: row for row in sections},
            municipalities={row["municipality_code"]: row for row in municipalities},
        )


_META: AreaMeta | None = None


def area_meta() -> AreaMeta:
    """Loaded once per process (~36k sections, a few MB)."""
    global _META
    if _META is None:
        _META = AreaMeta.load()
    return _META


class ImpactCounter:
    """Per-section sums of evaluated buildings, dwellings and built area, by
    damage state, accumulated batch by batch (engine.summarize_scenario).
    `municipality_stats()`/`section_stats()` turn them into the reported
    figures."""

    def __init__(self) -> None:
        # key -> (3, n_states): buildings, dwellings, built area
        self._sums: dict[str, np.ndarray] = {}

    def add(
        self,
        municipality_codes: pa.Array | pa.ChunkedArray,
        section_codes: pa.Array | pa.ChunkedArray,
        damage_state_code: np.ndarray,
        dwellings: np.ndarray,
        built_area_m2: np.ndarray,
    ) -> None:
        keys = _area_keys(municipality_codes, section_codes).dictionary_encode()
        indices = keys.indices.to_numpy(zero_copy_only=False)
        valid = keys.indices.is_valid().to_numpy(zero_copy_only=False)
        bins = indices[valid].astype(np.int64) * _N_STATES + damage_state_code[valid]
        size = len(keys.dictionary) * _N_STATES
        sums = np.stack(
            [
                np.bincount(bins, minlength=size),
                np.bincount(bins, weights=dwellings[valid], minlength=size),
                np.bincount(bins, weights=built_area_m2[valid], minlength=size),
            ]
        ).reshape(3, len(keys.dictionary), _N_STATES)
        for i, key in enumerate(keys.dictionary.to_pylist()):
            row = sums[:, i, :]
            if key in self._sums:
                self._sums[key] += row
            elif row[0].any():
                self._sums[key] = row.astype(np.float64)

    @property
    def n_damaged(self) -> int:
        """Non-None buildings, the same "affected" definition as the stats."""
        return int(sum(row[0, 1:].sum() for row in self._sums.values()))

    def section_stats(self, meta: AreaMeta | None = None) -> list[dict]:
        """One row per census section with at least one damaged building."""
        meta = meta or area_meta()
        rows = []
        for key, sums in sorted(self._sums.items()):
            if key.startswith(_NO_SECTION_PREFIX) or not sums[0, 1:].any():
                continue
            static = meta.sections.get(key, {})
            row = _section_figures(sums, static)
            rows.append(
                _report(
                    {
                        "section_code": key,
                        "municipality_code": key[:5],
                        "name": _section_label(key, static),
                        "bbox": _bbox(static),
                    },
                    sums,
                    row,
                    static,
                )
            )
        return rows

    def municipality_stats(self, meta: AreaMeta | None = None) -> list[dict]:
        """One row per evaluated municipality. Undamaged ones (the map and
        sidebar filter them out) carry only their code and counts: a large
        scenario evaluates thousands of them, and the full figures would
        double the response (PO011 "very_low", 3,276 evaluated / 1,129
        damaged municipalities: 1.8MB raw / 276KB gzipped with them, 924KB
        / 142KB without)."""
        meta = meta or area_meta()
        by_muni: dict[str, tuple[np.ndarray, dict[str, float]]] = {}
        for key, sums in self._sums.items():
            if key.startswith(_NO_SECTION_PREFIX):
                code = key[len(_NO_SECTION_PREFIX) :]
                figures = _section_figures(sums, {})
            else:
                code = key[:5]
                figures = _section_figures(sums, meta.sections.get(key, {}))
            if code in by_muni:
                total_sums, total = by_muni[code]
                total_sums += sums
                for name, value in figures.items():
                    total[name] += value
            else:
                by_muni[code] = (sums.copy(), figures)

        rows = []
        for code, (sums, figures) in sorted(by_muni.items()):
            counts = sums[0].astype(np.int64)
            if not counts[1:].any():
                rows.append(
                    {
                        "municipality_code": code,
                        "n_evaluated": int(counts.sum()),
                        "n_damaged": 0,
                        "counts": {state: int(n) for state, n in zip(DAMAGE_STATES, counts)},
                    }
                )
                continue
            static = meta.municipalities.get(code, {})
            rows.append(
                _report(
                    {"municipality_code": code, "name": static.get("name"), "bbox": _bbox(static)},
                    sums,
                    figures,
                    static,
                )
            )
        return rows


def _area_keys(
    municipality_codes: pa.Array | pa.ChunkedArray, section_codes: pa.Array | pa.ChunkedArray
) -> pa.Array:
    """Section code where there is one, else the no-section municipality key."""
    import pyarrow.compute as pc

    munis = _string_array(municipality_codes)
    for catastro, ine in _CATASTRO_CODE_TO_INE.items():
        munis = pc.if_else(pc.equal(munis, catastro), ine, munis)  # pyrefly: ignore -- generated at runtime
    fallback = pc.binary_join_element_wise(_NO_SECTION_PREFIX, munis, "")  # pyrefly: ignore
    return pc.coalesce(_string_array(section_codes), fallback)  # pyrefly: ignore


def _string_array(values: pa.Array | pa.ChunkedArray) -> pa.Array:
    if isinstance(values, pa.ChunkedArray):
        values = values.combine_chunks()
    return values.cast(pa.string())


def _section_figures(sums: np.ndarray, static: dict) -> dict[str, float]:
    """Additive figures for one section (or no-section municipality bucket),
    so a municipality's are the sum of its sections'."""
    buildings, dwellings, area = sums
    damaged = slice(1, None)
    population = float(static.get("population") or 0)
    vulnerable = float((static.get("pop_under_15") or 0) + (static.get("pop_65_plus") or 0))
    total_dwellings = float(static.get("n_dwellings") or 0)
    total_buildings = float(static.get("n_buildings") or 0)

    # Residents spread over the section's buildings by dwellings; a section
    # whose buildings record no dwellings at all (a handful nationally,
    # docs/impact-estimates.md) falls back to spreading them by building.
    if total_dwellings > 0:
        affected_share = dwellings[damaged].sum() / total_dwellings
        displaced_share = dwellings[_DISPLACED_MASK].sum() / total_dwellings
    elif total_buildings > 0:
        affected_share = buildings[damaged].sum() / total_buildings
        displaced_share = buildings[_DISPLACED_MASK].sum() / total_buildings
    else:
        affected_share = displaced_share = 0.0
    affected_share, displaced_share = min(affected_share, 1.0), min(displaced_share, 1.0)
    vulnerable_share = vulnerable / population if population > 0 else 0.0
    affected_population = population * affected_share

    return {
        "affected_population": affected_population,
        "affected_vulnerable_population": affected_population * vulnerable_share,
        "displaced_population": population * displaced_share,
        "cost_eur": float(area @ _COST_EUR_PER_M2),
        "debris_t": float(area @ _DEBRIS_T_PER_M2),
        "shoring_props": float(area @ _PROPS_PER_M2),
    }


def _report(ident: dict, sums: np.ndarray, figures: dict[str, float], static: dict) -> dict:
    """The JSON row for one area. `static` holds the area's own census
    totals (population, buildings) -- the denominators for percentages."""
    counts = sums[0].astype(np.int64)
    n_evaluated = int(counts.sum())
    n_damaged = int(counts[1:].sum())
    n_buildings = int(static.get("n_buildings") or 0) or n_evaluated
    population = int(static.get("population") or 0)
    vulnerable = int((static.get("pop_under_15") or 0) + (static.get("pop_65_plus") or 0))
    return {
        **ident,
        "n_evaluated": n_evaluated,
        "n_damaged": n_damaged,
        "counts": {state: int(n) for state, n in zip(DAMAGE_STATES, counts)},
        "n_buildings": n_buildings,
        "pct_buildings_affected": _pct(n_damaged, n_buildings),
        "population": population,
        "vulnerable_population": vulnerable,
        "affected_population": round(figures["affected_population"]),
        "pct_population_affected": _pct(figures["affected_population"], population),
        "affected_vulnerable_population": round(figures["affected_vulnerable_population"]),
        "pct_vulnerable_affected": _pct(figures["affected_vulnerable_population"], vulnerable),
        "displaced_population": round(figures["displaced_population"]),
        "cost_meur": round(figures["cost_eur"] / 1e6, 2),
        "debris_t": round(figures["debris_t"]),
        "truck_rotations": math.ceil(figures["debris_t"] / TRUCK_PAYLOAD_T),
        "shoring_props": round(figures["shoring_props"]),
    }


def _bbox(static: dict) -> list[float] | None:
    """[west, south, east, north], or None without census data (or from a
    sections_meta built before sections carried one)."""
    keys = ("bbox_xmin", "bbox_ymin", "bbox_xmax", "bbox_ymax")
    return [static[k] for k in keys] if all(k in static for k in keys) else None


def _pct(part: float, whole: float) -> float | None:
    return round(100.0 * part / whole, 2) if whole > 0 else None


def _section_label(code: str, static: dict) -> str:
    """ "Lorca 01-003": municipality name, district-section."""
    name = static.get("municipality_name") or code[:5]
    return f"{name} {code[5:7]}-{code[7:10]}"


def mean_severity(counts: dict[str, int]) -> float:
    """Average damage-state index (0 None .. 4 Complete) -- the map
    choropleth's colour input, same scale as a single building's colour."""
    total = sum(counts.values())
    if total == 0:
        return 0.0
    return sum(i * counts.get(s, 0) for i, s in enumerate(DAMAGE_STATES)) / total


def section_severity(stats: list[dict]) -> dict[str, float]:
    """section_code -> the value the map's section choropleth colours by:
    mean damage severity (0-4) for an earthquake, % of buildings flooded
    for a flood (flood.py's rows carry `n_flooded`, not damage counts)."""
    return {
        s["section_code"]: (
            round(s["pct_buildings_flooded"] or 0.0, 2)
            if "n_flooded" in s
            else round(mean_severity(s["counts"]), 3)
        )
        for s in stats
    }
