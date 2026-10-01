"""Lorca 2011: model vs observed damage, for every damage method and level.

CLI: uv run --package twiner-scenario python -m scenario.validate_lorca [--out file.md]

Runs the 11 May 2011 Lorca earthquake (manual mode: Mw 5.2 at 37.699,
-1.672, rake 44 -- docs/validation-lorca-2011.md §2) through every damage
model / vulnerability database combination (methods.py) at every
probability level, on the local national data, and compares the damage in
the **town** with what the town's post-earthquake inspection found.

The town is INE census district 01 of Lorca (30024): 43 sections, 7,001
buildings in our data, against the 7,890 the inspection paper counts. INE
district 02 is the rural pedanías; about 630 of its buildings, in sections
bordering the town, are part of the continuous built-up area and are not
included (docs/validation-lorca-2011.md §14).

Observed (Feriche et al. 2012, Física de la Tierra 24, 255-287): of the
town's 7,890 buildings, 7,839 were inspected and 6,416 have a municipal
inspection form: 4,035 slight (EMS-98 grades 1-2), 1,328 moderate (2-3),
689 moderate to severe (3-4) and 329 demolished (4-5).

Model figures are **expected** counts (each building's damage-state
probabilities summed, ADR-0034) and, for reference, **reported** counts
(the one state per building the map shows, following MERISUR's
probability levels).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from .engine import summarize_scenario
from .ground_motion import estimate_significant_distance_km
from .impact import area_meta
from .methods import compatible_methods
from .probability_level import PROBABILITY_LEVELS, resolve_probability_level
from .rupture import from_manual_input

LORCA = "30024"
TOWN_DISTRICT = "01"
EPICENTRE = {"lat": 37.699, "lon": -1.672, "mag": 5.2, "rake": 44.0}
STATES = ("None", "Slight", "Moderate", "Extensive", "Complete")

OBSERVED_TOWN_BUILDINGS = 7_890
OBSERVED = {"slight": 4_035, "moderate": 1_328, "moderate_to_severe": 689, "demolished": 329}
OBSERVED_ANY = sum(OBSERVED.values())  # 6,381
OBSERVED_MODERATE_PLUS = (
    OBSERVED["moderate"] + OBSERVED["moderate_to_severe"] + OBSERVED["demolished"]
)


def _paths() -> tuple[str, str, str]:
    """The same defaults bin/twiner uses for the local server."""
    data = os.environ.get("TWINER_DATA_DIR", "data")
    impact = f"{data}/exposure/buildings-cloud-impact.parquet"
    buildings = os.environ.get(
        "TWINER_BUILDINGS_PATH",
        impact if Path(impact).exists() else f"{data}/exposure/parts/*.buildings.parquet",
    )
    exposure = os.environ.get("TWINER_EXPOSURE_PATH", f"{data}/exposure/exposure.parquet")
    fragility = os.environ.get("TWINER_FRAGILITY_PATH", f"{data}/fragility/fragility.parquet")
    return buildings, exposure, fragility


def _sum_counts(rows: list[dict], key: str) -> dict[str, float]:
    return {s: sum(r[key][s] for r in rows) for s in STATES}


def run() -> list[dict]:
    """One result per (level, method): expected and reported counts for the
    town, and expected counts for the whole municipality."""
    buildings, exposure, fragility = _paths()
    meta = area_meta()
    town_sections = {
        code for code in meta.sections if code.startswith(LORCA) and code[5:7] == TOWN_DISTRICT
    }
    town_buildings = sum(int(meta.sections[c].get("n_buildings") or 0) for c in town_sections)
    rupture = from_manual_input(**EPICENTRE)
    results = []
    for level in PROBABILITY_LEVELS:
        params = resolve_probability_level(level)
        radius = estimate_significant_distance_km(rupture, sigma_multiplier=params.sigma_multiplier)
        for method in compatible_methods():
            summary = summarize_scenario(
                rupture,
                buildings,
                exposure,
                fragility,
                max_distance_km=radius,
                sigma_multiplier=params.sigma_multiplier,
                damage_percentile=params.damage_percentile,
                method=method,
            )
            sections = [
                s for s in summary.areas.section_stats(meta) if s["section_code"] in town_sections
            ]
            municipality = next(
                m for m in summary.areas.municipality_stats(meta) if m["municipality_code"] == LORCA
            )
            expected = _sum_counts(sections, "counts")
            reported = _sum_counts(sections, "counts_reported")
            # Sections with no damage at all are left out of section_stats;
            # their buildings are undamaged.
            expected["None"] += town_buildings - sum(expected.values())
            reported["None"] += town_buildings - sum(reported.values())
            results.append(
                {
                    "level": level,
                    "method": f"{method.model} + {method.database}",
                    "town_buildings": town_buildings,
                    "town_expected": expected,
                    "town_reported": reported,
                    "municipality_expected": municipality["counts"],
                }
            )
    return results


def _pct(n: float, total: float) -> str:
    return f"{100 * n / total:.0f}%"


def to_markdown(results: list[dict]) -> str:
    town = results[0]["town_buildings"]
    lines = [
        "# Lorca 2011: modelled vs observed damage in the town",
        "",
        (
            f"Town = INE district 01 of Lorca, {town:,} buildings. Observed: "
            f"{OBSERVED_TOWN_BUILDINGS:,} buildings (Feriche et al. 2012)."
        ),
        "",
        "| Level | Method | Slight | Moderate | Extensive | Complete | Any damage | Moderate+ |",
        "|---|---|---|---|---|---|---|---|",
        (
            f"| | **Observed** (inspection categories) | {OBSERVED['slight']:,} | "
            f"{OBSERVED['moderate']:,} | {OBSERVED['moderate_to_severe']:,} (mod.-severe) | "
            f"{OBSERVED['demolished']:,} (demolished) | {OBSERVED_ANY:,} "
            f"({_pct(OBSERVED_ANY, OBSERVED_TOWN_BUILDINGS)}) | {OBSERVED_MODERATE_PLUS:,} "
            f"({_pct(OBSERVED_MODERATE_PLUS, OBSERVED_TOWN_BUILDINGS)}) |"
        ),
    ]
    for r in results:
        e = r["town_expected"]
        any_damage = sum(e[s] for s in STATES[1:])
        mod_plus = sum(e[s] for s in STATES[2:])
        lines.append(
            f"| {r['level']} | {r['method']} | "
            + " | ".join(f"{e[s]:,.0f}" for s in STATES[1:])
            + f" | {any_damage:,.0f} ({_pct(any_damage, town)}) | {mod_plus:,.0f} "
            f"({_pct(mod_plus, town)}) |"
        )
    lines += [
        "",
        (
            "Model columns are expected counts (summed probabilities). Reported "
            "counts (one state per building, as on the map), for reference:"
        ),
        "",
        "| Level | Method | None | Slight | Moderate | Extensive | Complete |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        rep = r["town_reported"]
        lines.append(
            f"| {r['level']} | {r['method']} | "
            + " | ".join(f"{rep[s]:,.0f}" for s in STATES)
            + " |"
        )
    lines += [
        "",
        "Whole municipality of Lorca (27,884 buildings), expected counts:",
        "",
        "| Level | Method | Slight | Moderate | Extensive | Complete |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        m = r["municipality_expected"]
        lines.append(
            f"| {r['level']} | {r['method']} | "
            + " | ".join(f"{m[s]:,.0f}" for s in STATES[1:])
            + " |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", help="write the markdown here instead of printing it")
    args = parser.parse_args()
    markdown = to_markdown(run())
    if args.out:
        Path(args.out).write_text(markdown, encoding="utf-8")
    else:
        print(markdown)


if __name__ == "__main__":
    main()
