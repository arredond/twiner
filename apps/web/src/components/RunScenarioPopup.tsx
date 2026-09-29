import { useI18n } from "../settings";

// Content of Manual mode's "run scenario" popup (DamageMap renders it via
// a portal at the clicked point). The probability level is chosen in the
// map's mode panel (App.tsx), shared with Automatic mode, where clicking a
// fault runs it straight away.

// Manual mode's progressive complexity (ADR-0008): magnitude is the only
// required input; style-of-faulting and full geometry are optional tiers
// on top, not separate forms -- lifted to App so they persist between
// popups.
export interface ManualParams {
  lat: number;
  lon: number;
  mag: number;
  styleOfFaulting: "strike-slip" | "normal" | "reverse";
  advancedEnabled: boolean; // whether strike/dip/ztorKm are sent at all
  strike: number;
  dip: number;
  ztorKm: number;
}

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  fontSize: "0.85rem",
  maxHeight: "60vh",
  overflowY: "auto",
  paddingRight: "0.25rem",
};

export function ManualRunForm({
  params,
  onChange,
  onRun,
  isRunning,
}: {
  params: ManualParams;
  onChange: (update: (params: ManualParams) => ManualParams) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const { t } = useI18n();
  function set<K extends keyof ManualParams>(key: K, value: ManualParams[K]) {
    onChange((p) => ({ ...p, [key]: value }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
      style={formStyle}
    >
      <h3 style={{ fontSize: "0.95rem", margin: 0 }}>{t("manual.title")}</h3>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <label style={{ flex: 1 }}>
          {t("manual.latitude")}
          <input
            type="number"
            step="0.001"
            value={params.lat}
            onChange={(e) => set("lat", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ flex: 1 }}>
          {t("manual.longitude")}
          <input
            type="number"
            step="0.001"
            value={params.lon}
            onChange={(e) => set("lon", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
      </div>

      <label>
        {t("manual.magnitude")}
        <input
          type="number"
          step="0.1"
          min={3}
          max={9}
          value={params.mag}
          onChange={(e) => set("mag", Number(e.target.value))}
        />
      </label>

      <label>
        {t("manual.styleOfFaulting")}
        <select
          value={params.styleOfFaulting}
          onChange={(e) => set("styleOfFaulting", e.target.value as ManualParams["styleOfFaulting"])}
        >
          <option value="strike-slip">{t("manual.strikeSlip")}</option>
          <option value="normal">{t("manual.normal")}</option>
          <option value="reverse">{t("manual.reverse")}</option>
        </select>
      </label>

      <details open={params.advancedEnabled} onToggle={(e) => set("advancedEnabled", e.currentTarget.open)}>
        <summary style={{ cursor: "pointer" }}>{t("manual.advanced")}</summary>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {t("manual.advancedHint")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label>
            {t("manual.strike")}
            <input
              type="number"
              step="1"
              min={0}
              max={360}
              value={params.strike}
              onChange={(e) => set("strike", Number(e.target.value))}
            />
          </label>
          <label>
            {t("manual.dip")}
            <input
              type="number"
              step="1"
              min={1}
              max={90}
              value={params.dip}
              onChange={(e) => set("dip", Number(e.target.value))}
            />
          </label>
          <label>
            {t("manual.ztor")}
            <input
              type="number"
              step="0.5"
              min={0}
              value={params.ztorKm}
              onChange={(e) => set("ztorKm", Number(e.target.value))}
            />
          </label>
        </div>
      </details>

      <button type="submit" disabled={isRunning}>
        {isRunning ? t("app.running") : t("manual.run")}
      </button>
    </form>
  );
}
