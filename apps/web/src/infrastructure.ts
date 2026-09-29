import type { ExpressionSpecification } from "maplibre-gl";
import type { InfrastructureResult } from "./scenarioApi";

// Critical infrastructure (ADR-0025): the categories the pipeline
// (pipelines/exposure infrastructure.py) assigns, in panel order. `letter`
// marks each asset's map circle -- one glyph from the basemap's own font,
// no icon sprite needed.
export const INFRA_CATEGORIES = [
  { key: "health", label: "Health", letter: "H" },
  { key: "care", label: "Care homes", letter: "C" },
  { key: "emergency", label: "Emergency services", letter: "E" },
  { key: "education", label: "Education", letter: "S" },
  { key: "power", label: "Power", letter: "P" },
  { key: "bridge", label: "Bridges", letter: "B" },
  { key: "dam", label: "Dams", letter: "D" },
] as const;

export type InfraCategory = (typeof INFRA_CATEGORIES)[number]["key"];

export const INFRA_CATEGORY_KEYS: InfraCategory[] = INFRA_CATEGORIES.map((c) => c.key);

export function categoryLabel(key: string): string {
  return INFRA_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export const SUBTYPE_LABELS: Record<string, string> = {
  hospital: "Hospital",
  health_centre: "Health centre",
  care_home: "Care home",
  police: "Police / security",
  fire_civil_protection: "Fire / civil protection",
  school: "School",
  university: "University",
  substation: "Electrical substation",
  thermal: "Thermal power plant",
  hydro: "Hydroelectric plant",
  nuclear: "Nuclear power plant",
  solar_pv: "Solar PV plant",
  combined_cycle: "Combined-cycle plant",
  wind: "Wind farm",
  solar_thermal: "Solar thermal plant",
  bridge: "Bridge",
  dam: "Dam",
};

export function subtypeLabel(subtype: string): string {
  return SUBTYPE_LABELS[subtype] ?? subtype;
}

// Estimated macroseismic intensity (EMS-98 scale, from PGV via Worden et
// al. 2012 -- services/scenario infrastructure.py), IV..X. ColorBrewer's
// sequential Blues: kept apart from the damage palette (green..red) and
// the fault lines (purple) so bands, damage and faults never read as the
// same thing.
export const INTENSITY_LEVELS = [4, 5, 6, 7, 8, 9, 10] as const;
export const INTENSITY_COLORS: Record<number, string> = {
  4: "#c6dbef",
  5: "#9ecae1",
  6: "#6baed6",
  7: "#4292c6",
  8: "#2171b5",
  9: "#08519c",
  10: "#08306b",
};

// Mirrors services/scenario AFFECTED_INTENSITY: assets at or above it are
// the ones the API returns (plus facilities whose building is damaged).
export const AFFECTED_INTENSITY = 6;

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function roman(level: number): string {
  return ROMAN[level] ?? String(level);
}

// "VII (7.4)": the band a value falls in, and the value itself.
export function fmtIntensity(value: number): string {
  return `${roman(Math.floor(value))} (${value.toFixed(1)})`;
}

// Colour for a numeric intensity, by band (floor), for the map paint.
export function intensityColorExpr(input: ExpressionSpecification): ExpressionSpecification {
  return [
    "step",
    input,
    INTENSITY_COLORS[4],
    ...INTENSITY_LEVELS.slice(1).flatMap((level) => [level, INTENSITY_COLORS[level]]),
  ] as unknown as ExpressionSpecification;
}

export function countByCategory(rows: InfrastructureResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.category] = (counts[row.category] ?? 0) + 1;
  return counts;
}
