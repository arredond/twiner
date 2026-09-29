import { DAMAGE_STATES } from "./damageColors";
import type { AreaImpact } from "./scenarioApi";

// Shared by the impact sidebar and the map's municipality/section popups,
// so both show the same figures the same way.

const INT = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function fmtInt(n: number): string {
  return INT.format(n);
}

export function fmtPct(p: number | null): string {
  return p === null ? "—" : `${ONE_DECIMAL.format(p)}%`;
}

export function fmtMeur(meur: number): string {
  return meur >= 100 ? `${INT.format(meur)} M€` : `${ONE_DECIMAL.format(meur)} M€`;
}

// Average damage-state index (0 None .. 4 Complete) -- the choropleths'
// color input, on the same scale as a single building's color.
export function meanSeverity(area: Pick<AreaImpact, "counts" | "n_evaluated">): number {
  const total = area.n_evaluated || 1;
  return DAMAGE_STATES.reduce((sum, state, i) => sum + i * (area.counts[state] ?? 0), 0) / total;
}

// Label/value rows, in display order. `hint` explains how the number was
// estimated (docs/impact-estimates.md), shown as a hover tooltip -- the
// parameters quoted there mirror services/scenario/impact.py's constants;
// change both together.
export function impactRows(area: AreaImpact): Array<{ label: string; value: string; hint: string }> {
  return [
    {
      label: "Buildings affected",
      value: `${fmtPct(area.pct_buildings_affected)} (${fmtInt(area.n_damaged)} / ${fmtInt(area.n_buildings)})`,
      hint: "Buildings with any predicted damage (Slight or worse), out of every building in the area.",
    },
    {
      label: "Population",
      value: fmtInt(area.population),
      hint: "Residents, INE Censo Anual de Población, 1 Jan 2025.",
    },
    {
      label: "Population affected",
      value: `${fmtInt(area.affected_population)} (${fmtPct(area.pct_population_affected)})`,
      hint: "Residents of damaged buildings: each census section's population, spread over its buildings by number of dwellings.",
    },
    {
      label: "Vulnerable affected",
      value: `${fmtInt(area.affected_vulnerable_population)} (${fmtPct(area.pct_vulnerable_affected)})`,
      hint: "Affected residents under 15 or 65 and over, assuming each section's age mix applies to every building in it.",
    },
    {
      label: "Displaced",
      value: fmtInt(area.displaced_population),
      hint: "Residents of buildings with Extensive or Complete damage (likely unusable).",
    },
    {
      label: "Material cost",
      value: fmtMeur(area.cost_meur),
      hint: "Built floor area × €1,000/m² replacement cost × repair ratio (2/10/43/100% for Slight..Complete, HAZUS). Placeholder.",
    },
    {
      label: "Debris",
      value: `${fmtInt(area.debris_t)} t`,
      hint: "Built floor area × 1.1 t/m² × share turned to rubble (2/10/38/100% for Slight..Complete, HAZUS). Placeholder.",
    },
    {
      label: "Truck rotations",
      value: fmtInt(area.truck_rotations),
      hint: "Debris ÷ 20 t per dump-truck trip.",
    },
    {
      label: "Puntales (shoring props)",
      value: fmtInt(area.shoring_props),
      hint: "1 prop per m² over 5% (Moderate) / 20% (Extensive) of built floor area; Complete is demolished, not propped. Placeholder.",
    },
  ];
}
