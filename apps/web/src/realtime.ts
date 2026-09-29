import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import type { I18n, MessageKey } from "./i18n";
import { API_URL } from "./scenarioApi";

// Real-time layers (ADR-0026): DGT traffic incidents and AEMET station
// readings, both proxied by the scenario API (services/scenario
// realtime.py) -- DGT's feed has no CORS and AEMET's needs an API key.

// --- DGT incidents -----------------------------------------------------------

// realtime.py's categories (from the DATEX II causeType), in panel order.
export const DGT_CATEGORIES = [
  { key: "accident", color: "#e03131" },
  { key: "obstruction", color: "#f76707" },
  { key: "weather", color: "#1c7ed6" },
  { key: "congestion", color: "#9c36b5" },
  { key: "roadworks", color: "#fab005" },
  { key: "other", color: "#868e96" },
] as const;

export type DgtCategory = (typeof DGT_CATEGORIES)[number]["key"];
export const DGT_CATEGORY_KEYS: DgtCategory[] = DGT_CATEGORIES.map((c) => c.key);

export const INCIDENT_SOURCES = ["DGT", "SCT", "DT-GV"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export interface DgtIncidentProps {
  id: string;
  // Which feed: the DGT, Catalonia's SCT or the Basque Country's DT-GV.
  source: IncidentSource;
  situation_id: string;
  category: DgtCategory;
  cause: string | null;
  detail: string | null;
  record_type: string;
  management: string | null;
  speed_limit: string | null;
  severity: string | null;
  road: string | null;
  destination: string | null;
  direction: string | null;
  km_from: string | null;
  km_to: string | null;
  municipality: string | null;
  province: string | null;
  start_time: string | null;
  end_time: string | null;
}

export type DgtIncidents = FeatureCollection<Point, DgtIncidentProps> & {
  published: string | null;
  // Per feed: "ok", or why it didn't load (the others still show).
  sources: Record<string, string>;
};

// --- AEMET observations ------------------------------------------------------

export interface AemetStationProps {
  id: string;
  name: string | null;
  alt: number | null;
  time: string | null;
  // AEMET's own field names and units (°C, %, mm, m/s, degrees, hPa, km, cm);
  // only what the station reported in its latest hour.
  ta?: number;
  tamax?: number;
  tamin?: number;
  hr?: number;
  prec?: number;
  vv?: number;
  vmax?: number;
  dv?: number;
  pres?: number;
  vis?: number;
  nieve?: number;
}

export type AemetObservations = FeatureCollection<Point, AemetStationProps> & {
  observed: string | null;
};

// A metric the stations layer can colour by. `scale` converts AEMET's unit
// to the one shown (wind: m/s -> km/h); `stops` are in the shown unit.
export interface AemetMetric {
  key: "ta" | "hr" | "prec" | "vv" | "vmax" | "pres";
  unit: string;
  scale: number;
  digits: number;
  stops: ReadonlyArray<readonly [number, string]>;
}

const WIND_STOPS = [
  [0, "#f1eef6"],
  [20, "#bdc9e1"],
  [40, "#74a9cf"],
  [60, "#2b8cbe"],
  [90, "#045a8d"],
  [120, "#3f007d"],
] as const;

export const AEMET_METRICS: readonly AemetMetric[] = [
  {
    key: "ta",
    unit: "°C",
    scale: 1,
    digits: 1,
    stops: [
      [-10, "#313695"],
      [0, "#4575b4"],
      [10, "#abd9e9"],
      [20, "#fee090"],
      [30, "#f46d43"],
      [40, "#a50026"],
    ],
  },
  {
    key: "hr",
    unit: "%",
    scale: 1,
    digits: 0,
    stops: [
      [0, "#ffffcc"],
      [40, "#a1dab4"],
      [70, "#41b6c4"],
      [100, "#225ea8"],
    ],
  },
  {
    key: "prec",
    unit: "mm",
    scale: 1,
    digits: 1,
    stops: [
      [0, "#f7fbff"],
      [0.1, "#c6dbef"],
      [2, "#6baed6"],
      [10, "#2171b5"],
      [30, "#54278f"],
    ],
  },
  { key: "vv", unit: "km/h", scale: 3.6, digits: 0, stops: WIND_STOPS },
  { key: "vmax", unit: "km/h", scale: 3.6, digits: 0, stops: WIND_STOPS },
  {
    key: "pres",
    unit: "hPa",
    scale: 1,
    digits: 0,
    stops: [
      [980, "#762a83"],
      [1000, "#c2a5cf"],
      [1013, "#f7f7f7"],
      [1025, "#a6dba0"],
      [1040, "#1b7837"],
    ],
  },
];

export type AemetMetricKey = AemetMetric["key"];
export const DEFAULT_AEMET_METRIC: AemetMetricKey = "ta";

export function aemetMetric(key: AemetMetricKey): AemetMetric {
  return AEMET_METRICS.find((m) => m.key === key) ?? AEMET_METRICS[0];
}

// The metric's value in its shown unit, as a map expression.
export function aemetValueExpr(metric: AemetMetric): ExpressionSpecification {
  return ["*", ["to-number", ["get", metric.key]], metric.scale];
}

export function aemetColorExpr(metric: AemetMetric): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    aemetValueExpr(metric),
    ...metric.stops.flat(),
  ] as unknown as ExpressionSpecification;
}

export function fmtAemetValue(i18n: I18n, metric: AemetMetric, raw: number): string {
  return `${i18n.fmtDecimal(raw * metric.scale, metric.digits)} ${metric.unit}`;
}

// --- AEMET warnings (Meteoalerta) --------------------------------------------

// Meteoalerta's own colours, in panel order (worst first).
export const WARNING_LEVELS = [
  { key: "red", color: "#e3001b" },
  { key: "orange", color: "#ff8c00" },
  { key: "yellow", color: "#ffd400" },
] as const;

export type WarningLevel = (typeof WARNING_LEVELS)[number]["key"];

export interface AemetWarningProps {
  id: string;
  level: WarningLevel;
  level_rank: number;
  phenomenon: string;
  area: string | null;
  zone: string | null;
  // The alert's own text, in both of its languages.
  event_es: string | null;
  event_en: string | null;
  detail_es: string | null;
  detail_en: string | null;
  description_es: string | null;
  description_en: string | null;
  probability: string | null;
  onset: string | null;
  expires: string | null;
  onset_ms: number | null;
  expires_ms: number;
  sent: string | null;
}

export type AemetWarnings = FeatureCollection<Polygon | MultiPolygon, AemetWarningProps> & { issued: string | null };

// Which warnings show: those in force now, or at any time on one of the
// three days AEMET warns for (its own map's horizons).
export const WARNING_WINDOWS = ["now", "today", "tomorrow", "dayAfter"] as const;
export type WarningWindow = (typeof WARNING_WINDOWS)[number];

// [start, end) in epoch ms; a warning shows if it overlaps it. Days are the
// viewer's local days.
export function warningWindowMs(window: WarningWindow, now: number): [number, number] {
  if (window === "now") return [now, now + 1];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + WARNING_WINDOWS.indexOf(window) - 1);
  const start = day.getTime();
  day.setDate(day.getDate() + 1);
  return [start, day.getTime()];
}

export function overlapsWindow(props: AemetWarningProps, [start, end]: [number, number]): boolean {
  return (props.onset_ms ?? 0) < end && props.expires_ms > start;
}

// --- Fetching ----------------------------------------------------------------

// How often a layer that's switched on refetches. The API caches for a bit
// less than this (realtime.py's TTLs), so each refresh can see new data.
export const DGT_REFRESH_MS = 2 * 60_000;
export const AEMET_REFRESH_MS = 10 * 60_000;
export const AEMET_WARNINGS_REFRESH_MS = 10 * 60_000;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL.replace(/\/+$/, "")}${path}`);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.detail ?? body.error ?? message;
    } catch {
      // Not JSON: keep the status line.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const getDgtIncidents = () => getJson<DgtIncidents>("/realtime/dgt-incidents");
export const getAemetObservations = () => getJson<AemetObservations>("/realtime/aemet-observations");
export const getAemetWarnings = () => getJson<AemetWarnings>("/realtime/aemet-warnings");

// --- Labels -----------------------------------------------------------------

// A DATEX II enum value in the UI language (realtime.<group>.<value>), or
// de-camelCased as a fallback for values we haven't seen yet.
export function datexLabel(i18n: I18n, group: "detail" | "management" | "direction", value: string): string {
  const key = `realtime.dgt.${group}.${value}`;
  if (i18n.has(key)) return i18n.t(key as MessageKey);
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// "29/09 17:23": short local date and time.
export function fmtTime(i18n: I18n, iso: string | null): string | null {
  if (!iso) return null;
  // AEMET writes offsets as "+0000", which Date only takes as "+00:00".
  const date = new Date(iso.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(i18n.locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
