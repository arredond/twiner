import { useI18n, useSettings } from "../settings";
import type { FloodKind } from "../floodApi";
import { FLOOD_PALETTE, FLOOD_SHARE_STOPS, zoneColor, type FloodLayerToggles } from "./floodLayers";
import { LegendRow, type LayerStatus } from "./DamageLegend";
import { Switch } from "./Switch";

// Flood modes' legend sections (ADR-0029, ADR-0037), shown by DamageLegend in place of
// the seismic ones: the flood zones and the buildings in them, each with its
// own toggle. The affected municipalities/sections are DamageLegend's
// generic "Zonas afectadas" section, keyed by FloodShareKey.
export function FloodLegend({
  status,
  show,
  onShowChange,
  returnPeriod,
  kind,
}: {
  kind: FloodKind;
  status: LayerStatus;
  show: FloodLayerToggles;
  onShowChange: (show: FloodLayerToggles) => void;
  // The scenario's (or, before a run, the selected) return period.
  returnPeriod: number;
}) {
  const { theme } = useSettings();
  const { t } = useI18n();
  const palette = FLOOD_PALETTE[theme];
  // One line per layer: swatch, label, toggle.
  const row = (color: string, label: string, toggleLabel: string, on: boolean, set: (on: boolean) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600 }}>
      <span style={{ flex: 1, opacity: on ? 1 : 0.4 }}>
        <LegendRow color={color} label={label} />
      </span>
      {status === "loading" && (
        <span style={{ fontSize: "0.75rem", opacity: 0.6, fontWeight: 400 }}>{t("common.loadingInline")}</span>
      )}
      <Switch label={toggleLabel} checked={on} onChange={set} />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      {row(
        zoneColor(kind, theme),
        t(kind === "coast" ? "legend.coastZoneLine" : "legend.floodZoneLine", { period: returnPeriod }),
        t("legend.showFloodZones"),
        show.zones,
        (zones) => onShowChange({ ...show, zones })
      )}
      {row(
        palette.building,
        t("legend.floodedBuildings"),
        t("legend.showFloodedBuildings"),
        show.buildings,
        (buildings) => onShowChange({ ...show, buildings })
      )}
    </div>
  );
}

// The flood choropleth's colour key: % of an area's buildings in the zone.
export function FloodShareKey() {
  const { t, fmtInt } = useI18n();
  return (
    <>
      <div style={{ fontSize: "0.75rem", margin: "0.2rem 0" }}>{t("legend.floodShare")}</div>
      <div style={{ display: "flex" }}>
        {FLOOD_SHARE_STOPS.map(([stop, color]) => (
          <div key={stop} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: "0.7rem", background: color }} />
            <span style={{ fontSize: "0.7rem" }}>{fmtInt(stop)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}
