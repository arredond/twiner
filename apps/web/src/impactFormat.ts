import { DAMAGE_STATES } from "./damageColors";
import type { I18n } from "./i18n";
import type { AreaImpact } from "./scenarioApi";

// Shared by the impact sidebar and the map's municipality/section popups,
// so both show the same figures the same way. Numbers are formatted for
// the current language (I18n's fmt* helpers).

// Average damage-state index (0 None .. 4 Complete) -- the choropleths'
// color input, on the same scale as a single building's color.
export function meanSeverity(area: Pick<AreaImpact, "counts" | "n_evaluated">): number {
  const total = area.n_evaluated || 1;
  return DAMAGE_STATES.reduce((sum, state, i) => sum + i * (area.counts[state] ?? 0), 0) / total;
}

// Label/value rows, in display order. `hint` explains how the number was
// estimated (docs/impact-estimates.md), shown as a hover tooltip -- the
// parameters quoted in the catalogs' impact.*Hint strings mirror
// services/scenario/impact.py's constants; change both together.
export function impactRows(area: AreaImpact, i18n: I18n): Array<{ label: string; value: string; hint: string }> {
  const { t, fmtInt, fmtPct, fmtMeur } = i18n;
  return [
    {
      label: t("impact.buildingsAffected"),
      value: `${fmtPct(area.pct_buildings_affected)} (${fmtInt(area.n_damaged)} / ${fmtInt(area.n_buildings)})`,
      hint: t("impact.buildingsAffectedHint"),
    },
    {
      label: t("impact.population"),
      value: fmtInt(area.population),
      hint: t("impact.populationHint"),
    },
    {
      label: t("impact.populationAffected"),
      value: `${fmtInt(area.affected_population)} (${fmtPct(area.pct_population_affected)})`,
      hint: t("impact.populationAffectedHint"),
    },
    {
      label: t("impact.vulnerableAffected"),
      value: `${fmtInt(area.affected_vulnerable_population)} (${fmtPct(area.pct_vulnerable_affected)})`,
      hint: t("impact.vulnerableAffectedHint"),
    },
    {
      label: t("impact.displaced"),
      value: fmtInt(area.displaced_population),
      hint: t("impact.displacedHint"),
    },
    {
      label: t("impact.cost"),
      value: fmtMeur(area.cost_meur),
      hint: t("impact.costHint"),
    },
    {
      label: t("impact.debris"),
      value: `${fmtInt(area.debris_t)} t`,
      hint: t("impact.debrisHint"),
    },
    {
      label: t("impact.trucks"),
      value: fmtInt(area.truck_rotations),
      hint: t("impact.trucksHint"),
    },
    {
      label: t("impact.shoring"),
      value: fmtInt(area.shoring_props),
      hint: t("impact.shoringHint"),
    },
  ];
}
