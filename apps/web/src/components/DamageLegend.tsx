import { DAMAGE_COLORS, DAMAGE_STATES, MAP_PALETTE } from "../damageColors";
import {
  INFRA_CATEGORIES,
  INFRA_CATEGORY_KEYS,
  INTENSITY_COLORS,
  INTENSITY_LEVELS,
  categoryLabel,
  roman,
  type InfraCategory,
} from "../infrastructure";
import { useI18n, useSettings } from "../settings";
import { InfraIcon } from "./InfraIcon";
import { Switch } from "./Switch";

export type LayerStatus = "idle" | "loading" | "ready";

export function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span
        style={{
          display: "inline-block",
          width: "0.9rem",
          height: "0.9rem",
          background: color,
          borderRadius: 2,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

// A section heading for one group of map layers, with its toggle inline at
// the right and a small status affordance next to the title. Scenario
// compute is still synchronous end to end (services/scenario/
// results_store.py's docstring), so today `status` only ever flashes
// through "loading" for the duration of one request -- this exists so the
// UI already has the right shape once compute becomes an async job the
// frontend polls for, one layer's readiness at a time.
export function LayerSection({
  title,
  status,
  toggle,
  children,
}: {
  title: string;
  status: LayerStatus;
  toggle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
        <span style={{ flex: 1 }}>
          {title}
          {status === "loading" && (
            <span aria-label="loading" style={{ fontSize: "0.75rem", opacity: 0.6, fontWeight: 400 }}>
              {" "}
              {t("common.loadingInline")}
            </span>
          )}
        </span>
        {toggle}
      </div>
      <div style={{ opacity: status === "loading" ? 0.5 : 1 }}>{children}</div>
    </div>
  );
}

export interface DamageLegendProps {
  // QAFI active faults: on by default; Automatic mode runs a scenario by
  // clicking one.
  showFaults: boolean;
  onShowFaultsChange: (show: boolean) => void;
  // Buildings, the municipality/section choropleths and debris: one
  // section and one toggle, since they're all the same result.
  damageStatus?: LayerStatus;
  showDamage: boolean;
  onShowDamageChange: (show: boolean) => void;
  // Intensity bands (ADR-0025): off by default, available once a
  // scenario's bands have loaded.
  intensityStatus?: LayerStatus;
  showIntensity: boolean;
  onShowIntensityChange: (show: boolean) => void;
  // Critical infrastructure (ADR-0025): the categories drawn (none by
  // default), and after a run the number of affected assets in each.
  infraCategories: InfraCategory[];
  onInfraCategoriesChange: (categories: InfraCategory[]) => void;
  infraCounts: Record<string, number> | null;
}

export function DamageLegend({
  showFaults,
  onShowFaultsChange,
  damageStatus = "idle",
  showDamage,
  onShowDamageChange,
  intensityStatus = "idle",
  showIntensity,
  onShowIntensityChange,
  infraCategories,
  onInfraCategoriesChange,
  infraCounts,
}: DamageLegendProps) {
  const { theme, i18n } = useSettings();
  const { t } = i18n;
  const palette = MAP_PALETTE[theme];
  const toggleCategory = (key: InfraCategory, on: boolean) =>
    onInfraCategoriesChange(INFRA_CATEGORY_KEYS.filter((k) => (k === key ? on : infraCategories.includes(k))));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: "13.5rem" }}>
      <LayerSection
        title={t("legend.faults")}
        status="idle"
        toggle={<Switch label={t("legend.showFaults")} checked={showFaults} onChange={onShowFaultsChange} />}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: showFaults ? 1 : 0.4 }}>
          {/* The map's own dash pattern (2 on, 1 off at width 2). */}
          <svg width="0.9rem" height="0.9rem" viewBox="0 0 18 18" aria-hidden style={{ flex: "none" }}>
            <line x1="0" y1="9" x2="18" y2="9" stroke={palette.fault} strokeWidth="3" strokeDasharray="6 3" />
          </svg>
          <span>{t("legend.activeFault")}</span>
        </div>
      </LayerSection>
      <LayerSection
        title={t("legend.damage")}
        status={damageStatus}
        toggle={<Switch label={t("legend.showDamage")} checked={showDamage} onChange={onShowDamageChange} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", opacity: showDamage ? 1 : 0.4 }}>
          {DAMAGE_STATES.map((state) => (
            <LegendRow key={state} color={DAMAGE_COLORS[state]} label={t(`damage.${state}`)} />
          ))}
          {/* Distinct from "None": grey means the scenario never evaluated
              this building at all (outside the affected radius), not that
              it came out undamaged -- see DamageMap.tsx. */}
          <LegendRow color={DAMAGE_COLORS.Unknown} label={t("legend.notEvaluated")} />
          {/* Debris rings (ADR-0010): a separate concept from a building's
              own damage color, shown with it. */}
          <LegendRow color={palette.debris} label={t("legend.debris")} />
        </div>
      </LayerSection>

      <LayerSection
        title={t("legend.intensity")}
        status={intensityStatus}
        toggle={
          <Switch
            label={t("legend.showIntensity")}
            checked={showIntensity}
            disabled={intensityStatus !== "ready"}
            onChange={onShowIntensityChange}
          />
        }
      >
        {/* Also the colour of an asset's intensity chip in the sidebar
            (map markers themselves are plain black and white). */}
        <div style={{ display: "flex" }}>
          {INTENSITY_LEVELS.map((level) => (
            <div key={level} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: "0.7rem", background: INTENSITY_COLORS[level] }} />
              <span style={{ fontSize: "0.7rem" }}>{level === 10 ? "X+" : roman(level)}</span>
            </div>
          ))}
        </div>
      </LayerSection>

      <LayerSection
        title={t("legend.infrastructure")}
        status="idle"
        toggle={
          <Switch
            label={t("legend.showAllInfrastructure")}
            checked={infraCategories.length > 0}
            onChange={(on) => onInfraCategoriesChange(on ? INFRA_CATEGORY_KEYS : [])}
          />
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {INFRA_CATEGORIES.map((c) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <InfraIcon category={c.key} />
              <span style={{ flex: 1 }}>{categoryLabel(i18n, c.key)}</span>
              {infraCounts && (
                <span
                  title={t("legend.affectedInScenario")}
                  style={{ color: infraCounts[c.key] ? "var(--text)" : "var(--text-subtle)", fontVariantNumeric: "tabular-nums" }}
                >
                  {i18n.fmtInt(infraCounts[c.key] ?? 0)}
                </span>
              )}
              <Switch
                label={t("legend.showCategory", { category: categoryLabel(i18n, c.key).toLocaleLowerCase(i18n.locale) })}
                checked={infraCategories.includes(c.key)}
                onChange={(on) => toggleCategory(c.key, on)}
              />
            </div>
          ))}
        </div>
      </LayerSection>
    </div>
  );
}
