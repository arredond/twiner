import { DAMAGE_COLORS, DAMAGE_STATES, DEBRIS_COLOR } from "../damageColors";
import {
  INFRA_CATEGORIES,
  INFRA_CATEGORY_KEYS,
  INTENSITY_COLORS,
  INTENSITY_LEVELS,
  roman,
  type InfraCategory,
} from "../infrastructure";
import { Switch } from "./Switch";

export type LayerStatus = "idle" | "loading" | "ready";

function LegendRow({ color, label }: { color: string; label: string }) {
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
function LayerSection({
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
        <span style={{ flex: 1 }}>
          {title}
          {status === "loading" && (
            <span aria-label="loading" style={{ fontSize: "0.75rem", opacity: 0.6, fontWeight: 400 }}>
              {" "}
              loading…
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
  const toggleCategory = (key: InfraCategory, on: boolean) =>
    onInfraCategoriesChange(INFRA_CATEGORY_KEYS.filter((k) => (k === key ? on : infraCategories.includes(k))));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: "13.5rem" }}>
      <LayerSection
        title="Damage"
        status={damageStatus}
        toggle={<Switch label="Show damage" checked={showDamage} onChange={onShowDamageChange} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", opacity: showDamage ? 1 : 0.4 }}>
          {DAMAGE_STATES.map((state) => (
            <LegendRow key={state} color={DAMAGE_COLORS[state]} label={state} />
          ))}
          {/* Distinct from "None": grey means the scenario never evaluated
              this building at all (outside the affected radius), not that
              it came out undamaged -- see DamageMap.tsx. */}
          <LegendRow color={DAMAGE_COLORS.Unknown} label="Not evaluated" />
          {/* Debris rings (ADR-0010): a separate concept from a building's
              own damage color, shown with it. */}
          <LegendRow color={DEBRIS_COLOR} label="Debris (façade buffer)" />
        </div>
      </LayerSection>

      <LayerSection
        title="Intensity (EMS-98, est.)"
        status={intensityStatus}
        toggle={
          <Switch
            label="Show intensity bands"
            checked={showIntensity}
            disabled={intensityStatus !== "ready"}
            onChange={onShowIntensityChange}
          />
        }
      >
        {/* Also the colour of affected infrastructure, whether or not the
            bands themselves are on. */}
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
        title="Critical infrastructure"
        status="idle"
        toggle={
          <Switch
            label="Show all critical infrastructure"
            checked={infraCategories.length > 0}
            onChange={(on) => onInfraCategoriesChange(on ? INFRA_CATEGORY_KEYS : [])}
          />
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
          {INFRA_CATEGORIES.map((c) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={badge}>{c.letter}</span>
              <span style={{ flex: 1 }}>{c.label}</span>
              {infraCounts && (
                <span
                  title="Affected in this scenario"
                  style={{ color: infraCounts[c.key] ? "#1c1c1c" : "#999", fontVariantNumeric: "tabular-nums" }}
                >
                  {(infraCounts[c.key] ?? 0).toLocaleString()}
                </span>
              )}
              <Switch
                label={`Show ${c.label.toLowerCase()}`}
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

const badge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  width: "0.95rem",
  height: "0.95rem",
  borderRadius: "50%",
  border: "1px solid #333",
  background: "#fff",
  fontSize: "0.58rem",
  fontWeight: 700,
};
