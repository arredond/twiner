import type { ExpressionSpecification } from "maplibre-gl";
import type { I18n, MessageKey } from "./i18n";

// Critical infrastructure (ADR-0025): the categories the pipeline
// (pipelines/exposure infrastructure.py) assigns, in panel order. Labels:
// i18n's infra.category.<key>; icons: infraIcons.ts.
export const INFRA_CATEGORIES = [
  { key: "health" },
  { key: "care" },
  { key: "emergency" },
  { key: "education" },
  { key: "power" },
  { key: "bridge" },
  { key: "dam" },
] as const;

export type InfraCategory = (typeof INFRA_CATEGORIES)[number]["key"];

export const INFRA_CATEGORY_KEYS: InfraCategory[] = INFRA_CATEGORIES.map((c) => c.key);

export function categoryLabel(i18n: I18n, category: InfraCategory): string {
  return i18n.t(`infra.category.${category}`);
}

// i18n's infra.subtype.<subtype>; an unknown subtype shows as-is.
export function subtypeLabel(i18n: I18n, subtype: string): string {
  const key = `infra.subtype.${subtype}`;
  return i18n.has(key) ? i18n.t(key as MessageKey) : subtype;
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
export function fmtIntensity(i18n: I18n, value: number): string {
  return `${roman(Math.floor(value))} (${i18n.fmtDecimal(value)})`;
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
