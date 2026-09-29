import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { DAMAGE_STATES, SELECTED_COLOR } from "../damageColors";
import { fmtIntensity, intensityColorExpr, subtypeLabel } from "../infrastructure";
import {
  CATEGORY_ICONS,
  ICON_VARIANTS,
  SUBTYPE_ICONS,
  mapImageId,
  rasterizeInfraIcons,
  type IconVariant,
} from "../infraIcons";
import type { I18n, MessageKey } from "../i18n";
import type { InfrastructureResult, IntensityBands } from "../scenarioApi";
import { escapeHtml, renderProbabilityBarHtml } from "../popupHtml";
import { staticDataUrl } from "../staticData";

// Critical infrastructure and intensity bands on the map (ADR-0025). Kept
// out of DamageMap.tsx, which owns when these are added and fed.

const INFRASTRUCTURE_PMTILES_URL = staticDataUrl("infrastructure.pmtiles");
export const INFRA_SOURCE_ID = "infrastructure";
// Real geometry of plants/substations (polygons) and bridges/dams (lines),
// from z12; every asset's marker circle and its Maki icon (infraIcons.ts),
// one icon layer per colouring (see iconOpacity).
export const INFRA_SHAPES_FILL_LAYER_ID = "infrastructure-shapes-fill";
export const INFRA_SHAPES_LINE_LAYER_ID = "infrastructure-shapes-line";
export const INFRA_POINTS_LAYER_ID = "infrastructure-points";
const INFRA_ICON_LAYER_IDS: Record<IconVariant, string> = {
  dark: "infrastructure-icons-dark",
  light: "infrastructure-icons-light",
};
export const INFRA_CLICKABLE_LAYER_IDS = [
  INFRA_POINTS_LAYER_ID,
  INFRA_SHAPES_FILL_LAYER_ID,
  INFRA_SHAPES_LINE_LAYER_ID,
];
const INFRA_LAYER_IDS = [...INFRA_CLICKABLE_LAYER_IDS, ...Object.values(INFRA_ICON_LAYER_IDS)];
const SHAPES_MINZOOM = 12;
const ICONS_MINZOOM = 10;

export const INTENSITY_SOURCE_ID = "intensity-bands";
export const INTENSITY_FILL_LAYER_ID = "intensity-bands-fill";
const INTENSITY_LINE_LAYER_ID = "intensity-bands-line";

const NEUTRAL_FILL = "#ffffff";
const NEUTRAL_STROKE = "#333333";
// Assets a showing scenario didn't flag: kept on the map for context, but
// as small plain grey dots (no outline, no icon) so the affected ones
// are what stands out.
const INACTIVE_COLOR = "#9e9e9e";

const AFFECTED: ExpressionSpecification = ["!=", ["feature-state", "intensity"], null];
// The clicked/sidebar-picked asset (selectAsset): a pink ring or outline,
// like a selected building, and always drawn as a full marker -- even an
// inactive grey dot, so what was clicked is what lights up.
const SELECTED: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const SHOWN: ExpressionSpecification = ["any", AFFECTED, SELECTED];
// Ring width added to a selected marker's normal stroke.
const SELECTED_EXTRA_STROKE = 2;

// Marker size by zoom: [zoom, radius, radius when inactive]. `zoom` has to
// be the top-level interpolation input, so the inactive choice goes inside
// each stop.
const RADIUS_STOPS: Array<[number, number, number]> = [
  [5, 2.5, 1],
  [9, 4.5, 1.6],
  [11, 6, 2],
  // From z12 (neighbourhood scale, where buildings show) markers step up
  // so the icon inside reads at a glance, and keep growing to z16.
  [12, 9, 2.5],
  [16, 14, 3],
];
// Icon size (px, Maki's 15px glyph scaled) at the same zooms, kept about
// two thirds of the circle's diameter so a ring of colour shows around it.
const ICON_PX_STOPS: Array<[number, number]> = [
  [10, 7],
  [11, 8.5],
  [12, 12],
  [16, 19],
];
const STROKE_STOPS: Array<[number, number]> = [
  [5, 0.5],
  [10, 1.2],
];

function byZoom(stops: Array<[number, number | ExpressionSpecification]>): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;
}

// Point/icon/shape paint, before any scenario (`scenario` false: every
// asset a white marker with its icon) or with one showing (affected assets by
// intensity, the rest inactive grey dots).
function assetPaint(scenario: boolean) {
  // `active` for everything without a scenario; with one, `active` for
  // affected assets and `inactive` for the rest.
  const whenInactive = (
    active: number | string | ExpressionSpecification,
    inactive: number | string
  ): ExpressionSpecification =>
    (scenario ? ["case", SHOWN, active, inactive] : active) as unknown as ExpressionSpecification;
  const whenSelected = (selected: number | string, otherwise: number | string | ExpressionSpecification) =>
    ["case", SELECTED, selected, otherwise] as unknown as ExpressionSpecification;
  // A constant, typed to sit alongside the expressions (MapLibre takes
  // either for these properties).
  const plain = (value: number | string) => value as unknown as ExpressionSpecification;
  // Icon colouring: white on the two darkest intensity bands, dark on
  // everything else; neither on an inactive dot. icon-image is a layout
  // property, which can't read feature-state, so the choice is made by
  // opacity between the two icon layers instead.
  const onDarkBand: ExpressionSpecification = [">=", ["to-number", ["feature-state", "intensity"], 0], 9];
  const iconOpacity = (variant: IconVariant): ExpressionSpecification => {
    const active: ExpressionSpecification =
      variant === "light" ? ["case", onDarkBand, 1, 0] : ["case", onDarkBand, 0, 1];
    return whenInactive(active, 0);
  };
  return {
    circleRadius: byZoom(RADIUS_STOPS.map(([z, r, small]) => [z, scenario ? whenInactive(r, small) : r])),
    circleColor: scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : ASSET_COLOR,
    circleStrokeColor: whenSelected(SELECTED_COLOR, NEUTRAL_STROKE),
    circleStrokeWidth: byZoom(
      STROKE_STOPS.map(([z, w]) => [z, whenSelected(w + SELECTED_EXTRA_STROKE, scenario ? whenInactive(w, 0) : w)])
    ),
    iconOpacity: { dark: iconOpacity("dark"), light: iconOpacity("light") },
    fillColor: scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : ASSET_COLOR,
    fillOpacity: scenario ? whenInactive(0.6, 0.25) : plain(0.6),
    lineColor: whenSelected(SELECTED_COLOR, scenario ? whenInactive(ASSET_COLOR, INACTIVE_COLOR) : plain(NEUTRAL_STROKE)),
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

// An asset's icon in one colouring: by subtype, else by category, else none.
function iconImageExpr(variant: IconVariant): ExpressionSpecification {
  return [
    "match",
    ["get", "subtype"],
    ...Object.entries(SUBTYPE_ICONS).flatMap(([subtype, icon]) => [subtype, mapImageId(icon, variant)]),
    [
      "match",
      ["get", "category"],
      ...Object.entries(CATEGORY_ICONS).flatMap(([category, icon]) => [category, mapImageId(icon, variant)]),
      "",
    ],
  ] as unknown as ExpressionSpecification;
}

// Rasterized once per page (at least 2x, so they stay crisp on HiDPI),
// shared by every map instance and re-added after a style reload.
const ICON_PIXEL_RATIO = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
let iconImages: Map<string, ImageData> | null = null;
const iconImagesReady = rasterizeInfraIcons(ICON_PIXEL_RATIO).then((images) => (iconImages = images));

function addIconImages(map: MapLibreMap, images: Map<string, ImageData>): void {
  for (const [id, data] of images) {
    if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: ICON_PIXEL_RATIO });
  }
}

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
        "line-width": [
          "case",
          ["==", ["geometry-type"], "LineString"],
          ["case", SELECTED, 6, 4],
          ["case", SELECTED, 3, 1.5],
        ],
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
        "circle-stroke-color": assetPaint(false).circleStrokeColor,
        "circle-stroke-width": assetPaint(false).circleStrokeWidth,
      },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INFRA_ICON_LAYER_IDS.dark,
      type: "symbol",
      source: INFRA_SOURCE_ID,
      "source-layer": "points",
      minzoom: ICONS_MINZOOM,
      layout: iconLayout("dark"),
      paint: { "icon-opacity": assetPaint(false).iconOpacity.dark },
    },
    beforeId
  );
  map.addLayer(
    {
      id: INFRA_ICON_LAYER_IDS.light,
      type: "symbol",
      source: INFRA_SOURCE_ID,
      "source-layer": "points",
      minzoom: ICONS_MINZOOM,
      layout: iconLayout("light"),
      paint: { "icon-opacity": assetPaint(false).iconOpacity.light },
    },
    beforeId
  );

  // Icons are pixels MapLibre holds per style: added once rasterized, and
  // again on demand if a style reload drops them.
  void iconImagesReady.then((images) => addIconImages(map, images));
  map.on("styleimagemissing", (e: { id: string }) => {
    if (iconImages?.has(e.id)) addIconImages(map, iconImages);
  });
}

function iconLayout(variant: IconVariant) {
  return {
    visibility: "none" as const,
    "icon-image": iconImageExpr(variant),
    // Maki's 15px glyphs, sized to sit inside the marker circle.
    "icon-size": byZoom(ICON_PX_STOPS.map(([z, px]) => [z, px / 15])),
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
}

// Which categories show at all (the panel's toggles); none hides the layers.
export function setInfrastructureCategories(map: MapLibreMap, categories: string[]): void {
  const visibility = categories.length > 0 ? "visible" : "none";
  const byCategory: FilterSpecification = ["in", ["get", "category"], ["literal", categories]];
  for (const id of INFRA_LAYER_IDS) {
    map.setLayoutProperty(id, "visibility", visibility);
  }
  map.setFilter(INFRA_POINTS_LAYER_ID, byCategory);
  for (const id of Object.values(INFRA_ICON_LAYER_IDS)) map.setFilter(id, byCategory);
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
      // Just the intensity: a selection (selectAsset) outlives a new result.
      map.removeFeatureState({ source: INFRA_SOURCE_ID, sourceLayer, id }, "intensity");
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
  for (const variant of Object.keys(ICON_VARIANTS) as IconVariant[]) {
    map.setPaintProperty(INFRA_ICON_LAYER_IDS[variant], "icon-opacity", paint.iconOpacity[variant]);
  }
  map.setPaintProperty(INFRA_SHAPES_FILL_LAYER_ID, "fill-color", paint.fillColor);
  map.setPaintProperty(INFRA_SHAPES_FILL_LAYER_ID, "fill-opacity", paint.fillOpacity);
  map.setPaintProperty(INFRA_SHAPES_LINE_LAYER_ID, "line-color", paint.lineColor);
  return ids;
}

// Categories whose assets carry an official registry id, labelled
// infra.popup.registry.<category>.
// Moves the selection highlight from `previousId` to `id` (null: none) on
// both the asset's marker and its shape. Returns the now-selected id.
export function selectAsset(map: MapLibreMap, previousId: number | null, id: number | null): number | null {
  for (const sourceLayer of ["points", "shapes"]) {
    if (previousId !== null) {
      map.setFeatureState({ source: INFRA_SOURCE_ID, sourceLayer, id: previousId }, { selected: false });
    }
    if (id !== null) map.setFeatureState({ source: INFRA_SOURCE_ID, sourceLayer, id }, { selected: true });
  }
  return id;
}

const REGISTRY_CATEGORIES = new Set(["health", "education", "dam"]);

// `result`: this scenario's row for the asset, if it was flagged.
// `scenario`: whether a scenario is showing, and whether the asset lies in
// its evaluated area -- to tell "below VI" from "not assessed".
export function renderInfrastructurePopupHtml(
  props: Record<string, unknown>,
  result: InfrastructureResult | null,
  scenario: { withinEvaluatedRegion: boolean } | null,
  i18n: I18n
): string {
  const { t } = i18n;
  const subtype = subtypeLabel(i18n, String(props.subtype ?? ""));
  const title = props.name ? String(props.name) : subtype;
  const rows: Array<[string, string]> = [[t("infra.popup.type"), subtype]];
  if (props.detail)
    rows.push([props.subtype === "bridge" ? t("infra.popup.length") : t("infra.popup.voltage"), String(props.detail)]);
  const category = String(props.category);
  if (REGISTRY_CATEGORIES.has(category) && props.registry_id)
    rows.push([t(`infra.popup.registry.${category}` as MessageKey), String(props.registry_id)]);
  if (props.building_id) rows.push([t("infra.popup.catastroBuilding"), String(props.building_id)]);

  let impact = "";
  if (result) {
    rows.push([t("infra.popup.estimatedIntensity"), `${fmtIntensity(i18n, result.intensity)} EMS-98`]);
    if (result.damage_state_code !== null) {
      // Its building's own result: the state it's labelled with and the
      // whole distribution behind it (the same bar a building popup shows).
      const state = DAMAGE_STATES[result.damage_state_code];
      rows.push([t("infra.popup.buildingDamage"), state ? t(`damage.${state}`) : "—"]);
      if (result.damage_probs) impact = renderProbabilityBarHtml(result.damage_probs, i18n);
    }
  } else if (scenario) {
    rows.push([
      t("infra.popup.estimatedIntensity"),
      scenario.withinEvaluatedRegion ? t("infra.popup.belowAffected") : t("infra.popup.outsideEvaluated"),
    ]);
  }
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="color:var(--text-muted);padding-right:0.5rem">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
    )
    .join("");
  return (
    `<strong>${escapeHtml(title)}</strong>` +
    `<table style="font-size:0.8rem;margin-top:0.3rem">${body}</table>` +
    impact +
    `<div style="font-size:0.7rem;color:var(--text-subtle);margin-top:0.3rem">${escapeHtml(t("infra.popup.source"))}</div>`
  );
}
