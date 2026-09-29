import { DAMAGE_COLORS, DAMAGE_STATES, DEBRIS_COLOR } from "../damageColors";
import { INTENSITY_COLORS, INTENSITY_LEVELS, roman } from "../infrastructure";

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

// A section heading for one scenario layer (municipal stats / buildings /
// debris), with a small status affordance next to it. Scenario compute is
// still synchronous end to end (services/scenario/results_store.py's
// docstring), so today `status` only ever flashes through "loading" for the
// duration of one request -- this exists so the UI already has the right
// shape once compute becomes an async job the frontend polls for, one
// layer's readiness at a time (municipal stats first, then buildings, then
// debris).
function LayerSection({
  title,
  status,
  children,
}: {
  title: string;
  status: LayerStatus;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
        <span>{title}</span>
        {status === "loading" && (
          <span aria-label="loading" style={{ fontSize: "0.75rem", opacity: 0.6 }}>
            loading…
          </span>
        )}
      </div>
      <div style={{ opacity: status === "loading" ? 0.5 : 1 }}>{children}</div>
    </div>
  );
}

export interface DamageLegendProps {
  // Buildings and the municipality/section choropleths share one scale
  // (DamageMap.tsx colors areas by mean damage state), hence one section.
  damageStatus?: LayerStatus;
  debrisStatus?: LayerStatus;
  // Intensity bands (ADR-0025): their own toggle, off by default; only
  // offered once a scenario has bands to show.
  intensityStatus?: LayerStatus;
  showIntensity?: boolean;
  onShowIntensityChange?: (show: boolean) => void;
}

export function DamageLegend({
  damageStatus = "idle",
  debrisStatus = "idle",
  intensityStatus = "idle",
  showIntensity = false,
  onShowIntensityChange,
}: DamageLegendProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <LayerSection title="Damage" status={damageStatus}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {DAMAGE_STATES.map((state) => (
            <LegendRow key={state} color={DAMAGE_COLORS[state]} label={state} />
          ))}
          {/* Distinct from "None": grey means the scenario never evaluated
              this building at all (outside the affected radius), not that
              it came out undamaged -- see DamageMap.tsx. */}
          <LegendRow color={DAMAGE_COLORS.Unknown} label="Not evaluated" />
        </div>
      </LayerSection>
      <LayerSection title="Debris" status={debrisStatus}>
        {/* Debris rings (ADR-0010) are always shown after a scenario run --
            see DamageMap.tsx -- a separate concept from a building's own
            damage color, not a restatement of it. */}
        <LegendRow color={DEBRIS_COLOR} label="Debris (façade buffer)" />
      </LayerSection>
      <LayerSection title="Intensity (EMS-98, est.)" status={intensityStatus}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={showIntensity}
            disabled={intensityStatus !== "ready"}
            onChange={(e) => onShowIntensityChange?.(e.target.checked)}
          />
          Show intensity bands
        </label>
        {/* Also the colour of affected infrastructure (InfrastructurePanel),
            whether or not the bands themselves are on. */}
        <div style={{ display: "flex", marginTop: "0.3rem" }}>
          {INTENSITY_LEVELS.map((level) => (
            <div key={level} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: "0.7rem", background: INTENSITY_COLORS[level] }} />
              <span style={{ fontSize: "0.7rem" }}>{level === 10 ? "X+" : roman(level)}</span>
            </div>
          ))}
        </div>
      </LayerSection>
    </div>
  );
}
