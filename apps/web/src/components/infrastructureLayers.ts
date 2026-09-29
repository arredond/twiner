import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { DAMAGE_STATES } from "../damageColors";
import {
  INFRA_CATEGORIES,
  fmtIntensity,
  intensityColorExpr,
  subtypeLabel,
} from "../infrastructure";
import type { InfrastructureResult, IntensityBands } from "../scenarioApi";
import { escapeHtml, renderProbabilityBarHtml } from "../popupHtml";
import { staticDataUrl } from "../staticData";

// Critical infrastructure and intensity bands on the map (ADR-0025). Kept
// out of DamageMap.tsx, which owns when these are added and fed.

const INFRASTRUCTURE_PMTILES_URL = staticDataUrl("infrastructure.pmtiles");
export const INFRA_SOURCE_ID = "infrastructure";
// Real geometry of plants/substations (polygons) and bridges/dams (lines),
// from z12; every asset's marker circle and its category letter.
export const INFRA_SHAPES_FILL_LAYER_ID = "infrastructure-shapes-fill";
export const INFRA_SHAPES_LINE_LAYER_ID = "infrastructure-shapes-line";
export const INFRA_POINTS_LAYER_ID = "infrastructure-points";
const INFRA_LETTERS_LAYER_ID = "infrastructure-letters";
export const INFRA_CLICKABLE_LAYER_IDS = [
  INFRA_POINTS_LAYER_ID,
  INFRA_SHAPES_FILL_LAYER_ID,
  INFRA_SHAPES_LINE_LAYER_ID,
];
const INFRA_LAYER_IDS = [...INFRA_CLICKABLE_LAYER_IDS, INFRA_LETTERS_LAYER_ID];
const SHAPES_MINZOOM = 12;
const LETTERS_MINZOOM = 10;

export const INTENSITY_SOURCE_ID = "intensity-bands";
export const INTENSITY_FILL_LAYER_ID = "intensity-bands-fill";
const INTENSITY_LINE_LAYER_ID = "intensity-bands-line";

const NEUTRAL_FILL = "#ffffff";
const NEUTRAL_STROKE = "#333333";
// Assets a showing scenario didn't flag: kept on the map for context, but
// as small plain grey dots (no outline, no letter) so the affected ones
// are what stands out.
const INACTIVE_COLOR = "#9e9e9e";

const AFFECTED: ExpressionSpecification = ["!=", ["feature-state", "intensity"], null];

// Marker size by zoom: [zoom, radius, radius when inactive]. `zoom` has to
// be the top-level interpolation input, so the inactive choice goes inside
// each stop.
const RADIUS_STOPS: Array<[number, number, number]> = [
  [5, 2.5, 1],
  [9, 4.5, 1.6],
  [13, 8, 2.5],
];
const STROKE_STOPS: Array<[number, number]> = [
  [5, 0.5],
  [10, 1.2],
];

function byZoom(stops: Array<[number, number | ExpressionSpecification]>): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;
}

// Point/letter/shape paint, before any scenario (`scenario` false: every
// asset a white lettered marker) or with one showing (affected assets by
// intensity, the rest inactive grey dots).
function assetPaint(scenario: boolean) {
  // `active` for everything without a scenario; with one, `active` for
  // affected assets and `inactive` for the rest.
  const whenInactive = (
    active: number | string | ExpressionSpecification,
    inactive: number | string
  ): ExpressionSpecification =>
    (scenario ? ["case", AFFECTED, active, inactive] : active) as unknown as ExpressionSpecification;
  // A constant, typed to sit alongside the expressions (MapLibre takes
  // either for these properties).
  const plain = (value: number | string) => value as unknown as ExpressionSpecification;
  return {
    circleRadius: byZoom(RADIUS_STOPS.map(([z, r, small]) => [z, scenario ? whenInactive(r, small) : r])),
    circleColor: scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : ASSET_COLOR,
    circleStrokeWidth: byZoom(STROKE_STOPS.map(([z, w]) => [z, scenario ? whenInactive(w, 0) : w])),
    textOpacity: scenario ? whenInactive(1, 0) : plain(1),
    fillColor: scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : ASSET_COLOR,
    fillOpacity: scenario ? whenInactive(0.6, 0.25) : plain(0.6),
    lineColor: scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : plain(NEUTRAL_STROKE),
  };
}

// Colour by the asset's estimated intensity once a scenario has flagged it
// as affected (feature-state `intensity`, set from the API's rows), neutral
// otherwise.
const ASSET_COLOR: ExpressionSpecification = [
  "case",
  ["!=", ["feature-state", "intensity"], null],
  intensityColorExpr(["to-number", ["feature-state", "intensity"]]),
  NEUTRAL_FILL,
];

const LETTER_EXPR = [
  "match",
  ["get", "category"],
  ...INFRA_CATEGORIES.flatMap((c) => [c.key, c.letter]),
  "?",
] as unknown as ExpressionSpecification;

export function addIntensityLayers(map: MapLibreMap, beforeId?: string): void {
  map.addSource(INTENSITY_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer(
    {
      id: INTENSITY_FILL_LAYER_ID,
      type: "fill",
      source: INTENSITY_SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "fill-color": intensityColorExpr(["get", "intensity"]),
        "fill-opacity": 0.35,
      },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INTENSITY_LINE_LAYER_ID,
      type: "line",
      source: INTENSITY_SOURCE_ID,
      layout: { visibility: "none" },
      paint: {
        "line-color": intensityColorExpr(["get", "intensity"]),
        "line-width": 1,
      },
    },
    beforeId
  );
}

export function setIntensityBands(map: MapLibreMap, bands: IntensityBands | null, visible: boolean): void {
  (map.getSource(INTENSITY_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
    bands ?? { type: "FeatureCollection", features: [] }
  );
  const visibility = visible && bands ? "visible" : "none";
  for (const id of [INTENSITY_FILL_LAYER_ID, INTENSITY_LINE_LAYER_ID]) {
    map.setLayoutProperty(id, "visibility", visibility);
  }
}

export function addInfrastructureLayers(map: MapLibreMap, beforeId?: string): void {
  map.addSource(INFRA_SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${INFRASTRUCTURE_PMTILES_URL}`,
    // Feature ids are the BTN asset_id (tippecanoe --use-attribute-for-id),
    // unique per asset -- what the per-asset feature-state keys on.
  });
  const hidden = { visibility: "none" } as const;
  map.addLayer(
    {
      id: INFRA_SHAPES_FILL_LAYER_ID,
      type: "fill",
      source: INFRA_SOURCE_ID,
      "source-layer": "shapes",
      minzoom: SHAPES_MINZOOM,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: hidden,
      paint: { "fill-color": assetPaint(false).fillColor, "fill-opacity": 0.6 },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INFRA_SHAPES_LINE_LAYER_ID,
      type: "line",
      source: INFRA_SOURCE_ID,
      "source-layer": "shapes",
      minzoom: SHAPES_MINZOOM,
      layout: hidden,
      paint: {
        "line-color": assetPaint(false).lineColor,
        // Bridges and dams are lines: thick enough to see and click.
        "line-width": ["case", ["==", ["geometry-type"], "LineString"], 4, 1.5],
      },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INFRA_POINTS_LAYER_ID,
      type: "circle",
      source: INFRA_SOURCE_ID,
      "source-layer": "points",
      layout: hidden,
      paint: {
        "circle-radius": assetPaint(false).circleRadius,
        "circle-color": ASSET_COLOR,
        "circle-stroke-color": NEUTRAL_STROKE,
        "circle-stroke-width": assetPaint(false).circleStrokeWidth,
      },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INFRA_LETTERS_LAYER_ID,
      type: "symbol",
      source: INFRA_SOURCE_ID,
      "source-layer": "points",
      minzoom: LETTERS_MINZOOM,
      layout: {
        ...hidden,
        "text-field": LETTER_EXPR,
        "text-font": ["Open Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], LETTERS_MINZOOM, 7, 13, 10],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        // White on the two darkest bands, dark otherwise.
        "text-color": [
          "case",
          [">=", ["to-number", ["feature-state", "intensity"], 0], 9],
          "#ffffff",
          "#1c1c1c",
        ],
      },
    },
    beforeId
  );
}

// Which categories show at all (the panel's toggles); none hides the layers.
export function setInfrastructureCategories(map: MapLibreMap, categories: string[]): void {
  const visibility = categories.length > 0 ? "visible" : "none";
  const byCategory: FilterSpecification = ["in", ["get", "category"], ["literal", categories]];
  for (const id of INFRA_LAYER_IDS) {
    map.setLayoutProperty(id, "visibility", visibility);
  }
  map.setFilter(INFRA_POINTS_LAYER_ID, byCategory);
  map.setFilter(INFRA_LETTERS_LAYER_ID, byCategory);
  map.setFilter(INFRA_SHAPES_FILL_LAYER_ID, ["all", ["==", ["geometry-type"], "Polygon"], byCategory]);
  map.setFilter(INFRA_SHAPES_LINE_LAYER_ID, byCategory);
}

// Replaces the previous scenario's per-asset feature-state with this one's.
// With a scenario, assets it didn't flag fade back so the affected ones
// stand out. Returns the ids now carrying state, for the next call to clear.
export function applyInfrastructureResults(
  map: MapLibreMap,
  previousIds: Iterable<number>,
  rows: InfrastructureResult[] | null
): Set<number> {
  for (const id of previousIds) {
    for (const sourceLayer of ["points", "shapes"]) {
      map.removeFeatureState({ source: INFRA_SOURCE_ID, sourceLayer, id });
    }
  }
  const ids = new Set<number>();
  for (const row of rows ?? []) {
    for (const sourceLayer of ["points", "shapes"]) {
      map.setFeatureState(
        { source: INFRA_SOURCE_ID, sourceLayer, id: row.asset_id },
        { intensity: row.intensity }
      );
    }
    ids.add(row.asset_id);
  }
  const paint = assetPaint(rows !== null);
  map.setPaintProperty(INFRA_POINTS_LAYER_ID, "circle-radius", paint.circleRadius);
  map.setPaintProperty(INFRA_POINTS_LAYER_ID, "circle-color", paint.circleColor);
  map.setPaintProperty(INFRA_POINTS_LAYER_ID, "circle-stroke-width", paint.circleStrokeWidth);
  map.setPaintProperty(INFRA_LETTERS_LAYER_ID, "text-opacity", paint.textOpacity);
  map.setPaintProperty(INFRA_SHAPES_FILL_LAYER_ID, "fill-color", paint.fillColor);
  map.setPaintProperty(INFRA_SHAPES_FILL_LAYER_ID, "fill-opacity", paint.fillOpacity);
  map.setPaintProperty(INFRA_SHAPES_LINE_LAYER_ID, "line-color", paint.lineColor);
  return ids;
}

const REGISTRY_LABELS: Record<string, string> = {
  health: "National hospital catalogue (CNH) id",
  education: "School registry (RCD/RUCT) id",
  dam: "Dam inventory (IPE) id",
};

// `result`: this scenario's row for the asset, if it was flagged.
// `scenario`: whether a scenario is showing, and whether the asset lies in
// its evaluated area -- to tell "below VI" from "not assessed".
export function renderInfrastructurePopupHtml(
  props: Record<string, unknown>,
  result: InfrastructureResult | null,
  scenario: { withinEvaluatedRegion: boolean } | null
): string {
  const subtype = subtypeLabel(String(props.subtype ?? ""));
  const title = props.name ? String(props.name) : subtype;
  const rows: Array<[string, string]> = [["Type", subtype]];
  if (props.detail) rows.push([props.subtype === "bridge" ? "Length" : "Voltage", String(props.detail)]);
  const registryLabel = REGISTRY_LABELS[String(props.category)];
  if (registryLabel && props.registry_id) rows.push([registryLabel, String(props.registry_id)]);
  if (props.building_id) rows.push(["Catastro building", String(props.building_id)]);

  let impact = "";
  if (result) {
    rows.push(["Estimated intensity", `${fmtIntensity(result.intensity)} EMS-98`]);
    if (result.damage_state_code !== null) {
      // Its building's own result: the state it's labelled with and the
      // whole distribution behind it (the same bar a building popup shows).
      const state = DAMAGE_STATES[result.damage_state_code] ?? "Unknown";
      rows.push(["Building damage", state]);
      if (result.damage_probs) impact = renderProbabilityBarHtml(result.damage_probs);
    }
  } else if (scenario) {
    rows.push([
      "Estimated intensity",
      scenario.withinEvaluatedRegion ? "Below VI (not affected)" : "Outside the evaluated area",
    ]);
  }
  const body = rows
    .map(([k, v]) => `<tr><td style="color:#666;padding-right:0.5rem">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  return (
    `<strong>${escapeHtml(title)}</strong>` +
    `<table style="font-size:0.8rem;margin-top:0.3rem">${body}</table>` +
    impact +
    `<div style="font-size:0.7rem;color:#888;margin-top:0.3rem">Source: IGN Base Topográfica Nacional</div>`
  );
}
