import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { SELECTED_COLOR } from "../damageColors";
import type { AdminLevel, FloodAreaStats, FloodCircle, FloodRegion, ReturnPeriod } from "../floodApi";
import { RETURN_PERIODS } from "../floodApi";
import type { I18n } from "../i18n";
import type { Theme } from "../settings";
import { escapeHtml } from "../popupHtml";
import { staticDataUrl } from "../staticData";

// Flood mode on the map (ADR-0029). Kept out of DamageMap.tsx, which owns
// when these are added and fed:
//
// - flood zones (flood_zones.pmtiles) and flooded buildings
//   (flood_buildings.pmtiles), both static archives filtered in the
//   browser by return period and region -- no per-scenario tiles;
// - a per-municipality / per-section choropleth of % of buildings flooded,
//   on the existing municipality and section sources (feature-state
//   `flood_pct`);
// - the area picker: CCAA / province outlines (admin_areas.pmtiles) or
//   municipality outlines to click, and the drawn circle.

const FLOOD_ZONES_PMTILES_URL = staticDataUrl("flood_zones.pmtiles");
const FLOOD_BUILDINGS_PMTILES_URL = staticDataUrl("flood_buildings.pmtiles");
const ADMIN_AREAS_PMTILES_URL = staticDataUrl("admin_areas.pmtiles");

const ZONES_SOURCE_ID = "flood-zones";
const BUILDINGS_SOURCE_ID = "flood-buildings";
const ADMIN_SOURCE_ID = "admin-areas";
const REGION_SOURCE_ID = "flood-region";

export const FLOOD_ZONES_LAYER_ID = "flood-zones-fill";
export const FLOOD_BUILDINGS_LAYER_ID = "flood-buildings-fill";
const FLOOD_BUILDINGS_SELECTED_LAYER_ID = "flood-buildings-selected";
export const FLOOD_MUNICIPALITIES_LAYER_ID = "flood-municipalities-fill";
export const FLOOD_SECTIONS_LAYER_ID = "flood-sections-fill";
const REGION_FILL_LAYER_ID = "flood-region-fill";
const REGION_LINE_LAYER_ID = "flood-region-line";

// One pick layer (a near-transparent fill, for hit-testing and hover) and
// one outline per level.
export const PICK_FILL_LAYER_IDS: Record<AdminLevel, string> = {
  ccaa: "admin-pick-ccaa",
  province: "admin-pick-province",
  municipality: "admin-pick-municipality",
};
const PICK_LINE_LAYER_IDS: Record<AdminLevel, string> = {
  ccaa: "admin-pick-ccaa-line",
  province: "admin-pick-province-line",
  municipality: "admin-pick-municipality-line",
};
const HOVER_LINE_LAYER_IDS: Record<AdminLevel, string> = {
  ccaa: "admin-hover-ccaa",
  province: "admin-hover-province",
  municipality: "admin-hover-municipality",
};
// The scenario's own area, outlined.
const AREA_LINE_LAYER_IDS: Record<AdminLevel, string> = {
  ccaa: "flood-area-ccaa",
  province: "flood-area-province",
  municipality: "flood-area-municipality",
};

// The tile property holding each level's code, and its source/source-layer.
const LEVEL_SOURCES: Record<AdminLevel, { source: string; sourceLayer: string; codeProp: string }> = {
  ccaa: { source: ADMIN_SOURCE_ID, sourceLayer: "ccaa", codeProp: "code" },
  province: { source: ADMIN_SOURCE_ID, sourceLayer: "province", codeProp: "code" },
  // Filled in by addFloodLayers: the map's existing municipalities source.
  municipality: { source: "", sourceLayer: "municipalities", codeProp: "ine_code" },
};

const SECTIONS_MINZOOM = 9;
const BUILDINGS_MINZOOM = 12;
// Buildings in the flood zone show sooner than seismic buildings: there are
// far fewer of them, and they read well over the area choropleths.
const FLOOD_BUILDINGS_MINZOOM = 9;

// One hue per kind of thing, so the layers read apart at a glance: water
// blue for the flood zones (translucent), orange for the buildings in them,
// and a purple ramp (FLOOD_SHARE_STOPS) for the affected municipalities and
// sections. Outlines and the circle being drawn stay neutral.
export const FLOOD_PALETTE: Record<Theme, { zone: string; building: string; outline: string; draft: string }> = {
  light: { zone: "#2b83ba", building: "#e6550d", outline: "#1c1c1c", draft: "#525252" },
  dark: { zone: "#4ba3d6", building: "#fd8d3c", outline: "#f1f1f1", draft: "#bdbdbd" },
};

// % of an area's buildings in the flood zone -> colour (ColorBrewer
// Purples). Most areas are in single digits, so the ramp is steep at the
// bottom.
export const FLOOD_SHARE_STOPS: Array<[number, string]> = [
  [0, "#f2f0f7"],
  [2, "#dadaeb"],
  [5, "#bcbddc"],
  [10, "#9e9ac8"],
  [25, "#756bb1"],
  [50, "#54278f"],
];

// The colour an area's % flooded maps to (the sidebar cards' edge; the
// map interpolates between the same stops).
export function shareColor(pct: number | null): string {
  let color = FLOOD_SHARE_STOPS[0][1];
  for (const [stop, c] of FLOOD_SHARE_STOPS) if ((pct ?? 0) >= stop) color = c;
  return color;
}

const SHARE_COLOR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["feature-state", "flood_pct"], 0],
  ...FLOOD_SHARE_STOPS.flat(),
] as unknown as ExpressionSpecification;

const NONE: FilterSpecification = ["==", ["literal", 1], 0];

export function addFloodLayers(
  map: MapLibreMap,
  sources: { municipalities: string; sections: string },
  theme: Theme,
  beforeLayerId?: string
): void {
  LEVEL_SOURCES.municipality.source = sources.municipalities;
  const palette = FLOOD_PALETTE[theme];
  map.addSource(ZONES_SOURCE_ID, { type: "vector", url: `pmtiles://${FLOOD_ZONES_PMTILES_URL}` });
  map.addSource(BUILDINGS_SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${FLOOD_BUILDINGS_PMTILES_URL}`,
    promoteId: "building_id",
  });
  map.addSource(ADMIN_SOURCE_ID, {
    type: "vector",
    url: `pmtiles://${ADMIN_AREAS_PMTILES_URL}`,
    promoteId: "code",
  });
  map.addSource(REGION_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  const add = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => map.addLayer(layer, beforeLayerId);

  // Choropleths first (under the zones), each only in its own zoom band.
  add({
    id: FLOOD_MUNICIPALITIES_LAYER_ID,
    type: "fill",
    source: sources.municipalities,
    "source-layer": "municipalities",
    maxzoom: SECTIONS_MINZOOM,
    filter: NONE,
    paint: { "fill-color": SHARE_COLOR, "fill-opacity": 0.7, "fill-outline-color": "#00000033" },
  });
  add({
    id: FLOOD_SECTIONS_LAYER_ID,
    type: "fill",
    source: sources.sections,
    "source-layer": "sections",
    minzoom: SECTIONS_MINZOOM,
    maxzoom: BUILDINGS_MINZOOM,
    filter: NONE,
    paint: { "fill-color": SHARE_COLOR, "fill-opacity": 0.6, "fill-outline-color": "#00000022" },
  });
  add({
    id: FLOOD_ZONES_LAYER_ID,
    type: "fill",
    source: ZONES_SOURCE_ID,
    "source-layer": "flood_zones",
    filter: NONE,
    paint: { "fill-color": palette.zone, "fill-opacity": 0.45 },
  });

  for (const level of ["ccaa", "province", "municipality"] as AdminLevel[]) {
    const { source, sourceLayer } = LEVEL_SOURCES[level];
    add({
      id: PICK_FILL_LAYER_IDS[level],
      type: "fill",
      source,
      "source-layer": sourceLayer,
      layout: { visibility: "none" },
      // Near-transparent: there to be hovered and clicked.
      paint: { "fill-color": palette.draft, "fill-opacity": 0.03 },
    });
    add({
      id: PICK_LINE_LAYER_IDS[level],
      type: "line",
      source,
      "source-layer": sourceLayer,
      layout: { visibility: "none" },
      paint: { "line-color": palette.outline, "line-opacity": 0.5, "line-width": level === "municipality" ? 0.5 : 1 },
    });
    add({
      id: HOVER_LINE_LAYER_IDS[level],
      type: "line",
      source,
      "source-layer": sourceLayer,
      layout: { visibility: "none" },
      // Hover by feature-state, not setFilter: re-filtering re-lays out
      // every loaded tile of the source (~8k municipalities), which made
      // the outline lag well behind the cursor.
      paint: {
        "line-color": palette.draft,
        "line-width": 3,
        "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
      },
    });
    add({
      id: AREA_LINE_LAYER_IDS[level],
      type: "line",
      source,
      "source-layer": sourceLayer,
      filter: NONE,
      paint: { "line-color": palette.outline, "line-width": 2, "line-dasharray": [3, 2] },
    });
  }

  add({
    id: REGION_FILL_LAYER_ID,
    type: "fill",
    source: REGION_SOURCE_ID,
    paint: { "fill-color": palette.draft, "fill-opacity": ["case", ["get", "draft"], 0.12, 0] },
  });
  add({
    id: REGION_LINE_LAYER_ID,
    type: "line",
    source: REGION_SOURCE_ID,
    paint: {
      "line-color": ["case", ["get", "draft"], palette.draft, palette.outline],
      "line-width": 2,
      "line-dasharray": [3, 2],
    },
  });
}

// Flooded buildings go above the (static) buildings layer, which DamageMap
// re-adds whenever its source swaps; call after every such swap.
export function addFloodBuildingLayers(map: MapLibreMap, theme: Theme, beforeLayerId?: string): void {
  if (map.getLayer(FLOOD_BUILDINGS_LAYER_ID)) {
    map.moveLayer(FLOOD_BUILDINGS_LAYER_ID, beforeLayerId);
    map.moveLayer(FLOOD_BUILDINGS_SELECTED_LAYER_ID, beforeLayerId);
    return;
  }
  map.addLayer(
    {
      id: FLOOD_BUILDINGS_LAYER_ID,
      type: "fill",
      source: BUILDINGS_SOURCE_ID,
      "source-layer": "flood_buildings",
      minzoom: FLOOD_BUILDINGS_MINZOOM,
      filter: NONE,
      paint: { "fill-color": FLOOD_PALETTE[theme].building, "fill-opacity": 0.9 },
    },
    beforeLayerId
  );
  map.addLayer(
    {
      id: FLOOD_BUILDINGS_SELECTED_LAYER_ID,
      type: "line",
      source: BUILDINGS_SOURCE_ID,
      "source-layer": "flood_buildings",
      minzoom: FLOOD_BUILDINGS_MINZOOM,
      filter: NONE,
      paint: { "line-color": SELECTED_COLOR, "line-width": 2.5 },
    },
    beforeLayerId
  );
}

export function setFloodPaint(map: MapLibreMap, theme: Theme): void {
  const palette = FLOOD_PALETTE[theme];
  if (!map.getLayer(FLOOD_ZONES_LAYER_ID)) return;
  map.setPaintProperty(FLOOD_ZONES_LAYER_ID, "fill-color", palette.zone);
  if (map.getLayer(FLOOD_BUILDINGS_LAYER_ID))
    map.setPaintProperty(FLOOD_BUILDINGS_LAYER_ID, "fill-color", palette.building);
  for (const level of ["ccaa", "province", "municipality"] as AdminLevel[]) {
    map.setPaintProperty(PICK_FILL_LAYER_IDS[level], "fill-color", palette.draft);
    map.setPaintProperty(PICK_LINE_LAYER_IDS[level], "line-color", palette.outline);
    map.setPaintProperty(HOVER_LINE_LAYER_IDS[level], "line-color", palette.draft);
    map.setPaintProperty(AREA_LINE_LAYER_IDS[level], "line-color", palette.outline);
  }
  map.setPaintProperty(REGION_FILL_LAYER_ID, "fill-color", palette.draft);
  map.setPaintProperty(REGION_LINE_LAYER_ID, "line-color", ["case", ["get", "draft"], palette.draft, palette.outline]);
}

// --- area picker -------------------------------------------------------------

// Shows one level's outlines to click (null: none).
export function setAdminPicker(map: MapLibreMap, level: AdminLevel | null): void {
  for (const l of ["ccaa", "province", "municipality"] as AdminLevel[]) {
    const visibility = l === level ? "visible" : "none";
    map.setLayoutProperty(PICK_FILL_LAYER_IDS[l], "visibility", visibility);
    map.setLayoutProperty(PICK_LINE_LAYER_IDS[l], "visibility", visibility);
    map.setLayoutProperty(HOVER_LINE_LAYER_IDS[l], "visibility", visibility);
    if (l !== level) setAdminHover(map, l, null);
  }
}

// The hovered area per level, to move the `hover` feature-state off it.
const hovered: Partial<Record<AdminLevel, string>> = {};

export function setAdminHover(map: MapLibreMap, level: AdminLevel, code: string | null): void {
  const previous = hovered[level];
  if (previous === (code ?? undefined)) return;
  const { source, sourceLayer } = LEVEL_SOURCES[level];
  if (previous) map.setFeatureState({ source, sourceLayer, id: previous }, { hover: false });
  if (code) map.setFeatureState({ source, sourceLayer, id: code }, { hover: true });
  if (code) hovered[level] = code;
  else delete hovered[level];
}

// The code and name of a clicked/hovered pick feature.
export function pickedArea(
  level: AdminLevel,
  props: Record<string, unknown>
): { code: string; name: string } | null {
  const code = props[LEVEL_SOURCES[level].codeProp];
  return typeof code === "string" ? { code, name: String(props.name ?? code) } : null;
}

// --- circles -------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;

// A geodesic circle as a polygon (fine for drawing, not for measuring).
export function circlePolygon(lon: number, lat: number, radiusKm: number, steps = 96): Polygon {
  const ring: [number, number][] = [];
  const angular = radiusKm / EARTH_RADIUS_KM;
  const lat0 = (lat * Math.PI) / 180;
  const lon0 = (lon * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat1 = Math.asin(
      Math.sin(lat0) * Math.cos(angular) + Math.cos(lat0) * Math.sin(angular) * Math.cos(bearing)
    );
    const lon1 =
      lon0 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat0),
        Math.cos(angular) - Math.sin(lat0) * Math.sin(lat1)
      );
    ring.push([(lon1 * 180) / Math.PI, (lat1 * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function distanceKm(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat1 - lat0) * toRad;
  const dLon = (lon1 - lon0) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat0 * toRad) * Math.cos(lat1 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

// The circle being drawn (draft: filled) or the scenario's own (outlined).
export function setRegionCircle(map: MapLibreMap, circle: FloodCircle | null, draft: boolean): void {
  const features: Feature[] = circle
    ? [
        {
          type: "Feature",
          properties: { draft },
          geometry: circlePolygon(circle.lon, circle.lat, circle.radius_km),
        },
      ]
    : [];
  (map.getSource(REGION_SOURCE_ID) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
}

// --- scenario ---------------------------------------------------------------------

export interface FloodMapScenario {
  returnPeriod: ReturnPeriod;
  region: FloodRegion;
  // A CCAA's provinces (the tiles only carry section codes, whose first two
  // digits are the province).
  provinces: string[];
  // code -> % of buildings flooded.
  municipalityShares: Record<string, number>;
  sectionShares: Record<string, number>;
}

// Features of `prop` (a census-section or municipality code) inside the
// admin area.
function adminFilter(region: Extract<FloodRegion, { type: "admin" }>, provinces: string[], prop: string) {
  const code: ExpressionSpecification = ["coalesce", ["get", prop], ""];
  if (region.level === "municipality") return ["==", ["slice", code, 0, 5], region.code] as ExpressionSpecification;
  if (region.level === "province") return ["==", ["slice", code, 0, 2], region.code] as ExpressionSpecification;
  return ["in", ["slice", code, 0, 2], ["literal", provinces]] as ExpressionSpecification;
}

function regionFilter(scenario: FloodMapScenario, codeProp: string): ExpressionSpecification {
  const { region } = scenario;
  if (region.type === "admin") return adminFilter(region, scenario.provinces, codeProp);
  // Anything touching the circle: `distance` is 0 inside a polygon.
  return [
    "<=",
    ["distance", { type: "Point", coordinates: [region.lon, region.lat] }],
    region.radius_km * 1000,
  ] as unknown as ExpressionSpecification;
}

// Feature-state codes set by the previous scenario, to clear.
export interface FloodStateCodes {
  municipalities: string[];
  sections: string[];
}

export function setFloodScenario(
  map: MapLibreMap,
  scenario: FloodMapScenario | null,
  sources: { municipalities: string; sections: string },
  previous: FloodStateCodes
): FloodStateCodes {
  for (const code of previous.municipalities)
    map.removeFeatureState({ source: sources.municipalities, sourceLayer: "municipalities", id: code }, "flood_pct");
  for (const code of previous.sections)
    map.removeFeatureState({ source: sources.sections, sourceLayer: "sections", id: code }, "flood_pct");
  for (const level of ["ccaa", "province", "municipality"] as AdminLevel[])
    map.setFilter(AREA_LINE_LAYER_IDS[level], NONE);

  if (!scenario) {
    for (const id of [FLOOD_ZONES_LAYER_ID, FLOOD_BUILDINGS_LAYER_ID, FLOOD_MUNICIPALITIES_LAYER_ID, FLOOD_SECTIONS_LAYER_ID])
      if (map.getLayer(id)) map.setFilter(id, NONE);
    setRegionCircle(map, null, false);
    selectFloodBuilding(map, null);
    return { municipalities: [], sections: [] };
  }

  const rp = scenario.returnPeriod;
  // `to-number`: tolerates an archive built before `rp` was typed as an
  // int (pipelines/flood tiles.py), where it's a string.
  map.setFilter(FLOOD_ZONES_LAYER_ID, [
    "all",
    ["==", ["to-number", ["get", "rp"]], rp],
    regionFilter(scenario, "sec"),
  ]);
  if (map.getLayer(FLOOD_BUILDINGS_LAYER_ID))
    map.setFilter(FLOOD_BUILDINGS_LAYER_ID, [
      "all",
      ["==", ["get", `t${rp}`], 1],
      regionFilter(scenario, "sec"),
    ]);

  const municipalities = Object.keys(scenario.municipalityShares);
  const sections = Object.keys(scenario.sectionShares);
  for (const [code, pct] of Object.entries(scenario.municipalityShares))
    map.setFeatureState({ source: sources.municipalities, sourceLayer: "municipalities", id: code }, { flood_pct: pct });
  for (const [code, pct] of Object.entries(scenario.sectionShares))
    map.setFeatureState({ source: sources.sections, sourceLayer: "sections", id: code }, { flood_pct: pct });
  map.setFilter(
    FLOOD_MUNICIPALITIES_LAYER_ID,
    municipalities.length ? ["in", ["get", "ine_code"], ["literal", municipalities]] : NONE
  );
  map.setFilter(FLOOD_SECTIONS_LAYER_ID, sections.length ? ["in", ["get", "code"], ["literal", sections]] : NONE);

  if (scenario.region.type === "circle") {
    setRegionCircle(map, scenario.region, false);
  } else {
    setRegionCircle(map, null, false);
    const { codeProp } = LEVEL_SOURCES[scenario.region.level];
    map.setFilter(AREA_LINE_LAYER_IDS[scenario.region.level], ["==", ["get", codeProp], scenario.region.code]);
  }
  return { municipalities, sections };
}

// The legend's three flood toggles: zones, buildings in them, and the
// affected municipalities/sections ("Zonas afectadas").
export interface FloodLayerToggles {
  zones: boolean;
  buildings: boolean;
  areas: boolean;
}

export function setFloodLayersVisible(map: MapLibreMap, show: FloodLayerToggles | null): void {
  const groups: Array<[string[], boolean]> = [
    [[FLOOD_ZONES_LAYER_ID], show?.zones ?? false],
    [[FLOOD_BUILDINGS_LAYER_ID, FLOOD_BUILDINGS_SELECTED_LAYER_ID], show?.buildings ?? false],
    [[FLOOD_MUNICIPALITIES_LAYER_ID, FLOOD_SECTIONS_LAYER_ID], show?.areas ?? false],
  ];
  for (const [ids, visible] of groups)
    for (const id of ids)
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

export function selectFloodBuilding(map: MapLibreMap, buildingId: string | null): void {
  if (map.getLayer(FLOOD_BUILDINGS_SELECTED_LAYER_ID))
    map.setFilter(FLOOD_BUILDINGS_SELECTED_LAYER_ID, buildingId ? ["==", ["get", "building_id"], buildingId] : NONE);
}

// --- popups -----------------------------------------------------------------------

// A flooded building: the return periods whose zone it's in (a tile's
// `t<rp>` flags: 1/0, absent where that period isn't mapped).
export function renderFloodBuildingPopupHtml(props: Record<string, unknown>, i18n: I18n): string {
  const { t } = i18n;
  const rows = RETURN_PERIODS.map((rp) => {
    const flag = props[`t${rp}`];
    const value =
      flag === 1 ? t("flood.popup.inZone") : flag === 0 ? t("flood.popup.notInZone") : t("flood.popup.notMapped");
    return `<tr><td style="color:var(--text-muted);padding-right:0.5rem">T=${rp}</td><td>${escapeHtml(value)}</td></tr>`;
  }).join("");
  return (
    `<strong>${escapeHtml(t("flood.popup.buildingTitle"))}</strong>` +
    `<div style="font-size:0.75rem;color:var(--text-subtle)">${escapeHtml(String(props.building_id ?? ""))}</div>` +
    `<table style="font-size:0.8rem;margin-top:0.3rem">${rows}</table>` +
    `<div style="font-size:0.7rem;color:var(--text-subtle);margin-top:0.3rem">${escapeHtml(t("flood.source"))}</div>`
  );
}

export function floodAreaRows(area: FloodAreaStats, i18n: I18n): Array<{ label: string; value: string; hint: string }> {
  const { t, fmtInt, fmtPct, fmtDecimal } = i18n;
  return [
    {
      label: t("flood.buildingsFlooded"),
      value: `${fmtPct(area.pct_buildings_flooded)} (${fmtInt(area.n_flooded)} / ${fmtInt(area.n_buildings)})`,
      hint: t("flood.buildingsFloodedHint"),
    },
    { label: t("flood.dwellingsFlooded"), value: fmtInt(area.flooded_dwellings), hint: t("flood.dwellingsFloodedHint") },
    { label: t("impact.population"), value: fmtInt(area.population), hint: t("impact.populationHint") },
    {
      label: t("flood.populationAffected"),
      value: `${fmtInt(area.affected_population)} (${fmtPct(area.pct_population_affected)})`,
      hint: t("flood.populationAffectedHint"),
    },
    {
      label: t("impact.vulnerableAffected"),
      value: `${fmtInt(area.affected_vulnerable_population)} (${fmtPct(area.pct_vulnerable_affected)})`,
      hint: t("impact.vulnerableAffectedHint"),
    },
    {
      label: t("flood.floodedArea"),
      value: `${fmtDecimal(area.flooded_area_km2)} km²`,
      hint: t("flood.areaHint"),
    },
  ];
}

export function renderFloodAreaPopupHtml(title: string, area: FloodAreaStats | null | "loading", i18n: I18n): string {
  const { t } = i18n;
  let body: string;
  if (area === "loading") body = `<div style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(t("common.loading"))}</div>`;
  else if (!area) body = `<div style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(t("flood.popup.noFlooding"))}</div>`;
  else
    body = `<table style="font-size:0.8rem;margin-top:0.3rem">${floodAreaRows(area, i18n)
      .map(
        (r) =>
          `<tr title="${escapeHtml(r.hint)}"><td style="color:var(--text-muted);padding-right:0.5rem">${escapeHtml(r.label)}</td><td style="text-align:right">${escapeHtml(r.value)}</td></tr>`
      )
      .join("")}</table>`;
  return `<strong>${escapeHtml(title)}</strong>${body}`;
}
