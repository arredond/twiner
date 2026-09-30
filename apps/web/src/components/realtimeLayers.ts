import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { I18n, MessageKey } from "../i18n";
import type { Theme } from "../settings";
import { escapeHtml } from "../popupHtml";
import {
  AEMET_METRICS,
  DGT_CATEGORIES,
  WARNING_LEVELS,
  aemetColorExpr,
  aemetValueExpr,
  datexLabel,
  fmtAemetValue,
  fmtTime,
  type AemetMetric,
  type AemetObservations,
  type AemetWarnings,
  type DgtCategory,
  type DgtIncidents,
} from "../realtime";

// Real-time layers on the map (ADR-0026): DGT incidents, AEMET stations
// and AEMET warnings, as GeoJSON sources App.tsx refreshes. Kept out of DamageMap.tsx,
// which owns when these are added and fed.

const WARNINGS_SOURCE_ID = "aemet-warnings";
export const WARNINGS_FILL_LAYER_ID = "aemet-warnings-fill";
const WARNINGS_LINE_LAYER_ID = "aemet-warnings-line";
const DGT_SOURCE_ID = "dgt-incidents";
export const DGT_LAYER_ID = "dgt-incidents";
// Affected stretches, drawn along the road (services/scenario roads.py):
// a line per stretch, under the incident markers, with a contrasting casing.
export const DGT_LINE_LAYER_ID = "dgt-incidents-line";
const DGT_LINE_CASING_LAYER_ID = "dgt-incidents-line-casing";
const IS_POINT: ExpressionSpecification = ["==", ["geometry-type"], "Point"];
const IS_LINE: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
const AEMET_SOURCE_ID = "aemet-stations";
export const AEMET_LAYER_ID = "aemet-stations";
const AEMET_LABEL_LAYER_ID = "aemet-stations-label";
export const REALTIME_CLICKABLE_LAYER_IDS = [DGT_LAYER_ID, DGT_LINE_LAYER_ID, AEMET_LAYER_ID];

// Station values show as text from here in, where stations stop overlapping.
const AEMET_LABEL_MINZOOM = 7;
// One of the fonts pipelines/basemap hosts. A single font, not a
// fallback list: the glyphs are static files per font, and MapLibre asks
// for a list as one combined stack.
const LABEL_FONT = ["Noto Sans Medium"];

// Marker outline and label halo: whatever contrasts with the basemap.
const INK: Record<Theme, { stroke: string; halo: string; text: string }> = {
  light: { stroke: "#ffffff", halo: "#ffffff", text: "#1c1c1c" },
  dark: { stroke: "#1c1c1c", halo: "#1c1c1c", text: "#f1f1f1" },
};

const EMPTY = { type: "FeatureCollection" as const, features: [] };

const DGT_COLOR: ExpressionSpecification = [
  "match",
  ["get", "category"],
  ...DGT_CATEGORIES.flatMap((c) => [c.key, c.color]),
  DGT_CATEGORIES[DGT_CATEGORIES.length - 1].color,
] as unknown as ExpressionSpecification;

const WARNING_COLOR: ExpressionSpecification = [
  "match",
  ["get", "level"],
  ...WARNING_LEVELS.flatMap((l) => [l.key, l.color]),
  WARNING_LEVELS[WARNING_LEVELS.length - 1].color,
] as unknown as ExpressionSpecification;

export function addRealtimeLayers(map: MapLibreMap, theme: Theme): void {
  const ink = INK[theme];
  // Warnings first: areas, under every point layer. Higher levels on top
  // where a zone has several (the API also sends them in that order).
  map.addSource(WARNINGS_SOURCE_ID, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: WARNINGS_FILL_LAYER_ID,
    type: "fill",
    source: WARNINGS_SOURCE_ID,
    layout: { visibility: "none", "fill-sort-key": ["get", "level_rank"] },
    paint: { "fill-color": WARNING_COLOR, "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: WARNINGS_LINE_LAYER_ID,
    type: "line",
    source: WARNINGS_SOURCE_ID,
    layout: { visibility: "none", "line-sort-key": ["get", "level_rank"] },
    paint: { "line-color": WARNING_COLOR, "line-width": 1.2 },
  });

  map.addSource(AEMET_SOURCE_ID, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: AEMET_LAYER_ID,
    type: "circle",
    source: AEMET_SOURCE_ID,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 7, 5, 11, 8],
      "circle-color": aemetColorExpr(AEMET_METRICS[0]),
      "circle-stroke-color": ink.stroke,
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: AEMET_LABEL_LAYER_ID,
    type: "symbol",
    source: AEMET_SOURCE_ID,
    minzoom: AEMET_LABEL_MINZOOM,
    layout: {
      visibility: "none",
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-offset": [0, -1.1],
      "text-anchor": "bottom",
      "text-field": "",
    },
    paint: {
      "text-color": ink.text,
      "text-halo-color": ink.halo,
      "text-halo-width": 1.5,
    },
  });

  // Incidents above the stations: they're what needs acting on.
  map.addSource(DGT_SOURCE_ID, { type: "geojson", data: EMPTY });
  const lineWidth: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 3.5, 14, 6];
  map.addLayer({
    id: DGT_LINE_CASING_LAYER_ID,
    type: "line",
    source: DGT_SOURCE_ID,
    filter: IS_LINE,
    layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ink.stroke,
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 10, 5.5, 14, 9],
    },
  });
  map.addLayer({
    id: DGT_LINE_LAYER_ID,
    type: "line",
    source: DGT_SOURCE_ID,
    filter: IS_LINE,
    layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": DGT_COLOR, "line-width": lineWidth },
  });
  map.addLayer({
    id: DGT_LAYER_ID,
    type: "circle",
    source: DGT_SOURCE_ID,
    filter: IS_POINT,
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 8, 5, 12, 8],
      "circle-color": DGT_COLOR,
      "circle-stroke-color": ink.stroke,
      "circle-stroke-width": 1.2,
    },
  });
}

export function setRealtimePaint(map: MapLibreMap, theme: Theme): void {
  const ink = INK[theme];
  map.setPaintProperty(DGT_LAYER_ID, "circle-stroke-color", ink.stroke);
  map.setPaintProperty(DGT_LINE_CASING_LAYER_ID, "line-color", ink.stroke);
  map.setPaintProperty(AEMET_LAYER_ID, "circle-stroke-color", ink.stroke);
  map.setPaintProperty(AEMET_LABEL_LAYER_ID, "text-color", ink.text);
  map.setPaintProperty(AEMET_LABEL_LAYER_ID, "text-halo-color", ink.halo);
}

// `window`: [start, end) in epoch ms (realtime.ts warningWindowMs); null
// data = layer off.
export function setAemetWarnings(map: MapLibreMap, data: AemetWarnings | null, window: [number, number]): void {
  (map.getSource(WARNINGS_SOURCE_ID) as GeoJSONSource).setData(data ?? EMPTY);
  const filter: ExpressionSpecification = [
    "all",
    ["<", ["coalesce", ["get", "onset_ms"], 0], window[1]],
    [">", ["get", "expires_ms"], window[0]],
  ];
  for (const id of [WARNINGS_FILL_LAYER_ID, WARNINGS_LINE_LAYER_ID]) {
    map.setFilter(id, filter);
    map.setLayoutProperty(id, "visibility", data ? "visible" : "none");
  }
}

export function setDgtIncidents(map: MapLibreMap, data: DgtIncidents | null, categories: DgtCategory[]): void {
  (map.getSource(DGT_SOURCE_ID) as GeoJSONSource).setData(data ?? EMPTY);
  const inCategories: ExpressionSpecification = ["in", ["get", "category"], ["literal", categories]];
  const visibility = data && categories.length > 0 ? "visible" : "none";
  for (const [id, geometry] of [
    [DGT_LAYER_ID, IS_POINT],
    [DGT_LINE_LAYER_ID, IS_LINE],
    [DGT_LINE_CASING_LAYER_ID, IS_LINE],
  ] as const) {
    map.setFilter(id, ["all", geometry, inCategories]);
    map.setLayoutProperty(id, "visibility", visibility);
  }
}

export function setAemetStations(
  map: MapLibreMap,
  data: AemetObservations | null,
  metric: AemetMetric,
  locale: string
): void {
  (map.getSource(AEMET_SOURCE_ID) as GeoJSONSource).setData(data ?? EMPTY);
  // Stations that didn't report this metric aren't drawn at all, rather
  // than in some "no data" colour that reads as a value.
  const filter: ExpressionSpecification = ["has", metric.key];
  for (const id of [AEMET_LAYER_ID, AEMET_LABEL_LAYER_ID]) {
    map.setFilter(id, filter);
    map.setLayoutProperty(id, "visibility", data ? "visible" : "none");
  }
  map.setPaintProperty(AEMET_LAYER_ID, "circle-color", aemetColorExpr(metric));
  map.setLayoutProperty(AEMET_LABEL_LAYER_ID, "text-field", [
    "number-format",
    aemetValueExpr(metric),
    {
      locale,
      "max-fraction-digits": metric.digits,
      "min-fraction-digits": metric.digits,
    },
  ]);
}

// --- Popups ---------------------------------------------------------------

function table(rows: Array<[string, string | null | undefined]>): string {
  return (
    `<table style="border-collapse:collapse;margin-top:4px">` +
    rows
      .filter(([, v]) => v != null && v !== "")
      .map(
        ([k, v]) =>
          `<tr><td style="color:var(--text-muted);padding-right:0.5rem;vertical-align:top">${escapeHtml(k)}</td>` +
          `<td>${escapeHtml(v)}</td></tr>`
      )
      .join("") +
    `</table>`
  );
}

function source(text: string): string {
  return `<div style="margin-top:4px;font-size:0.7rem;color:var(--text-subtle)">${escapeHtml(text)}</div>`;
}

// Properties as they come off a clicked GeoJSON feature: nulls dropped.
type Props = Record<string, unknown>;
const str = (value: unknown): string | null => (value == null || value === "" ? null : String(value));

export function renderDgtPopupHtml(props: Props, i18n: I18n): string {
  const { t } = i18n;
  const category = DGT_CATEGORIES.find((c) => c.key === props.category) ?? DGT_CATEGORIES[DGT_CATEGORIES.length - 1];
  const detail = str(props.detail);
  const title = detail ? datexLabel(i18n, "detail", detail) : t(`realtime.dgt.category.${category.key}`);
  const road = [str(props.road), str(props.destination) && `→ ${props.destination}`].filter(Boolean).join(" ");
  const kmFrom = str(props.km_from);
  const kmTo = str(props.km_to);
  const km = kmFrom && kmTo && kmFrom !== kmTo ? `${kmFrom} – ${kmTo}` : kmFrom;
  const direction = str(props.direction);
  const management = str(props.management);
  const severity = str(props.severity);
  const place = [str(props.municipality), str(props.province) && `(${props.province})`].filter(Boolean).join(" ");
  const speedLimit = str(props.speed_limit);
  return (
    `<div style="display:flex;align-items:center;gap:0.4rem">` +
    `<span style="flex:none;width:0.7rem;height:0.7rem;border-radius:50%;background:${category.color}"></span>` +
    `<strong>${escapeHtml(title)}</strong></div>` +
    table([
      [t("realtime.dgt.popup.road"), road],
      [t("realtime.dgt.popup.km"), km],
      [
        t("realtime.dgt.popup.direction"),
        direction && direction !== "unknown" ? datexLabel(i18n, "direction", direction) : null,
      ],
      [t("realtime.dgt.popup.effect"), management ? datexLabel(i18n, "management", management) : null],
      [t("realtime.dgt.popup.speedLimit"), speedLimit && `${speedLimit} km/h`],
      [
        t("realtime.dgt.popup.severity"),
        severity && i18n.has(`realtime.dgt.severity.${severity}`)
          ? t(`realtime.dgt.severity.${severity}` as MessageKey)
          : severity,
      ],
      [t("realtime.dgt.popup.location"), place],
      [t("realtime.dgt.popup.since"), fmtTime(i18n, str(props.start_time))],
      [t("realtime.dgt.popup.until"), fmtTime(i18n, str(props.end_time))],
    ]) +
    source(
      i18n.has(`realtime.dgt.source.${props.source}`)
        ? t(`realtime.dgt.source.${props.source}` as MessageKey)
        : t("realtime.dgt.source.DGT")
    )
  );
}

export function renderAemetPopupHtml(props: Props, selected: AemetMetric, i18n: I18n): string {
  const { t } = i18n;
  const rows: Array<[string, string | null]> = AEMET_METRICS.map((metric) => {
    const raw = props[metric.key];
    if (typeof raw !== "number") return [t(`realtime.aemet.metric.${metric.key}`), null];
    let value = fmtAemetValue(i18n, metric, raw);
    if (metric.key === "vv" && typeof props.dv === "number") value += ` (${Math.round(props.dv)}°)`;
    return [t(`realtime.aemet.metric.${metric.key}`) + (metric === selected ? " ●" : ""), value];
  });
  if (typeof props.tamax === "number" && typeof props.tamin === "number")
    rows.splice(1, 0, [
      t("realtime.aemet.popup.minMax"),
      `${i18n.fmtDecimal(props.tamin)} / ${i18n.fmtDecimal(props.tamax)} °C`,
    ]);
  if (typeof props.vis === "number")
    rows.push([t("realtime.aemet.popup.visibility"), `${i18n.fmtDecimal(props.vis)} km`]);
  if (typeof props.nieve === "number") rows.push([t("realtime.aemet.popup.snow"), `${i18n.fmtInt(props.nieve)} cm`]);
  if (typeof props.alt === "number") rows.push([t("realtime.aemet.popup.altitude"), `${i18n.fmtInt(props.alt)} m`]);
  rows.push([t("realtime.aemet.popup.observed"), fmtTime(i18n, str(props.time))]);
  return (
    `<strong>${escapeHtml(str(props.name) ?? str(props.id))}</strong>` +
    table(rows) +
    source(t("realtime.aemet.source"))
  );
}

// Every warning under a click (a zone often has several: consecutive time
// slices, or 1 h and 12 h rainfall), worst first, in the UI language.
export function renderWarningsPopupHtml(warnings: Props[], i18n: I18n): string {
  const { t } = i18n;
  const lang = i18n.lang === "en" ? "en" : "es";
  const sorted = [...warnings].sort(
    (a, b) => Number(b.level_rank) - Number(a.level_rank) || String(a.onset).localeCompare(String(b.onset))
  );
  const areas = [...new Set(sorted.map((w) => str(w.area)).filter(Boolean))];
  const items = sorted
    .map((w) => {
      const color = WARNING_LEVELS.find((l) => l.key === w.level)?.color ?? "#999";
      const detail = str(w[`detail_${lang}`]);
      const description = str(w[`description_${lang}`]);
      // The description often just restates the detail ("...: 40 mm.").
      const extra = description && description.replace(/\.$/, "") !== detail ? description : null;
      return (
        `<div style="border-left:4px solid ${color};padding-left:0.4rem;margin-top:0.4rem">` +
        `<strong>${escapeHtml(str(w[`event_${lang}`]) ?? w.phenomenon)}</strong>` +
        (detail ? `<div>${escapeHtml(detail)}</div>` : "") +
        (extra ? `<div>${escapeHtml(extra)}</div>` : "") +
        `<div style="color:var(--text-muted)">${escapeHtml(
          `${fmtTime(i18n, str(w.onset)) ?? "—"} – ${fmtTime(i18n, str(w.expires)) ?? "—"}`
        )}` +
        (w.probability
          ? ` · ${escapeHtml(t("realtime.warnings.probability", { value: String(w.probability) }))}`
          : "") +
        `</div></div>`
      );
    })
    .join("");
  return `<strong>${escapeHtml(areas.join(", "))}</strong>` + items + source(t("realtime.warnings.source"));
}
