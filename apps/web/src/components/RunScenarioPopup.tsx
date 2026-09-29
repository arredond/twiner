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
      <h3 style={{ fontSize: "0.95rem", margin: 0 }}>Manual earthquake</h3>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <label style={{ flex: 1 }}>
          Latitude
          <input
            type="number"
            step="0.001"
            value={params.lat}
            onChange={(e) => set("lat", Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ flex: 1 }}>
          Longitude
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
        Magnitude (Mw)
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
        Style of faulting
        <select
          value={params.styleOfFaulting}
          onChange={(e) => set("styleOfFaulting", e.target.value as ManualParams["styleOfFaulting"])}
        >
          <option value="strike-slip">Strike-slip (default)</option>
          <option value="normal">Normal</option>
          <option value="reverse">Reverse</option>
        </select>
      </label>

      <details open={params.advancedEnabled} onToggle={(e) => set("advancedEnabled", e.currentTarget.open)}>
        <summary style={{ cursor: "pointer" }}>Advanced: fault geometry (strike/dip/depth)</summary>
        <p style={{ fontSize: "0.75rem", color: "#666" }}>
          Computes a real finite rupture plane (length/width derived from magnitude) instead of treating the
          earthquake as a single point.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label>
            Strike (°, 0-360, direction the fault runs)
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
            Dip (°, 0-90, tilt from horizontal)
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
            Depth to top of rupture (km)
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
        {isRunning ? "Running scenario…" : "Run scenario"}
      </button>
    </form>
  );
}
