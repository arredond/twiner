import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { DAMAGE_COLORS, DAMAGE_STATES, MAP_PALETTE, SELECTED_COLOR } from "../damageColors";
import { rasterStyle, type Basemap, type View } from "../basemaps";
import type { I18n } from "../i18n";
import type { Theme } from "../settings";
import { staticDataUrl } from "../staticData";
import { impactRows, meanSeverity } from "../impactFormat";
import { escapeHtml, renderProbabilityBarHtml } from "../popupHtml";
import {
  getBuildingInfo,
  TILES_API_URL,
  type AreaImpact,
  type BuildingDamageResult,
  type EvaluatedRegion,
  type Fault,
  type InfrastructureResult,
  type IntensityBands,
  type MunicipalityStats,
  type SectionStats,
} from "../scenarioApi";
import {
  applyBasemapLanguage,
  collectBasemapLabels,
  localizeLayers,
  type BasemapLabels,
} from "./basemapLabels";
import {
  INFRA_CLICKABLE_LAYER_IDS,
  INFRA_SHAPES_FILL_LAYER_ID,
  addInfrastructureLayers,
  addIntensityLayers,
  applyInfrastructureResults,
  selectAsset,
  setInfrastructurePaint,
  renderInfrastructurePopupHtml,
  setInfrastructureCategories,
  setIntensityBands,
} from "./infrastructureLayers";
import {
  AEMET_LAYER_ID,
  DGT_LAYER_ID,
  DGT_LINE_LAYER_ID,
  REALTIME_CLICKABLE_LAYER_IDS,
  WARNINGS_FILL_LAYER_ID,
  addRealtimeLayers,
  renderAemetPopupHtml,
  renderDgtPopupHtml,
  renderWarningsPopupHtml,
  setAemetStations,
  setAemetWarnings,
  setDgtIncidents,
  setRealtimePaint,
} from "./realtimeLayers";
import {
  aemetMetric,
  type AemetMetricKey,
  type AemetObservations,
  type AemetWarnings,
  type DgtCategory,
  type DgtIncidents,
} from "../realtime";

// MapLibre 6 locates its worker at runtime (`new URL("./maplibre-gl-worker.mjs",
// import.meta.url)` built from a template string), which Vite's production
// build can't see -- so the worker was never emitted into dist/assets, and
// on Cloudflare Pages the request fell through to index.html ("non-JavaScript
// MIME type"), leaving no tiles parsed at all. Dev never showed this since
// maplibre-gl is excluded from pre-bundling (vite.config.ts) and served
// straight from node_modules, worker file alongside it. `?worker&url` has
// Vite bundle the worker *with* its own `./maplibre-gl-shared.mjs` import
// into one emitted file (a plain `?url` would copy it alone and break that
// import); vite.config.ts' `worker.format: "es"` keeps it a module worker,
// which is how MapLibre starts any worker URL not ending in `.cjs`.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

// Precomputed-tiling architecture (docs/decisions/0003-precomputed-building-tiles.md):
// building geometry is a static PMTiles layer, tiled once offline by the
// exposure pipeline. Once a scenario has run, its own results are joined
// onto that geometry server-side, one tile at a time, by
// services/scenario/tile_join.py -- each `buildings` feature comes back
// with `damage_state_code`/`prob_*` already attached when this scenario
// touched that building, so the frontend never needs to fetch a
// building_id list and setFeatureState it in one-by-one (the previous
// design, which didn't scale past ~100k affected buildings). Before any
// scenario has run, the map falls back to the plain static PMTiles archive
// with no join. Debris rings get the same treatment (ADR-0019): a joined
// debris tile carries only each damaged building's one matching ring.
// The scenario response itself carries no per-building data at all.
const BUILDINGS_PMTILES_URL = staticDataUrl("buildings.pmtiles");

const BUILDINGS_SOURCE_ID = "buildings";
const BUILDINGS_LAYER_ID = "buildings-fill";
const BUILDINGS_OUTLINE_LAYER_ID = "buildings-selected-outline";

// Click-to-highlight (buildings and debris): a pink outline on its own thin
// line layer, painted from the "selected" feature-state -- kept separate
// from each layer's own fill-color/fill-opacity choropleth paint so the
// highlight never fights with it (see the two *_OUTLINE_LAYER_ID layers
// below).
const SELECTED_OUTLINE_COLOR = SELECTED_COLOR;
const SELECTED_OUTLINE_PAINT: maplibregl.ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_OUTLINE_COLOR,
  "rgba(0,0,0,0)",
];

// Debris envelopes (ADR-0010, docs/decisions/0010-debris-envelope-precompute.md):
// precomputed offline, one PMTiles layer per building's 1-4m rings, same
// static-tiling pattern as buildings above. A scenario run computes nothing
// new for this layer -- it just sets each building's damage_state_code as
// feature-state (below), same as the buildings layer, and the paint
// expression shows only the one ring matching that code (each ring's
// geometry is cumulative -- 0m to the ring's own distance -- so the
// matching ring already covers everything a lower ring would show).
const DEBRIS_PMTILES_URL = staticDataUrl("debris.pmtiles");
const DEBRIS_SOURCE_ID = "debris";
const DEBRIS_LAYER_ID = "debris-fill";
const DEBRIS_OUTLINE_LAYER_ID = "debris-selected-outline";
const DEBRIS_RING_OPACITY = 1;

// Municipal boundaries (IGN/CNIG, see pipelines/exposure/src/exposure/
// municipalities.py and DATA-SOURCES.md): a low-zoom choropleth of
// aggregate per-municipality stats, standing in for individual buildings
// until the user zooms in far enough to make picking one out useful.
// `n_buildings` is a precomputed tile property (the pipeline's own count
// of that municipality's buildings.parquet part) -- the denominator for
// "percent affected"; the numerator (`n_evaluated`/per-damage-state
// counts) comes from the current scenario's `municipality_stats` and is
// set as feature-state, same promoteId-keyed pattern as buildings' damage
// color.
const MUNICIPALITIES_PMTILES_URL = staticDataUrl("municipalities.pmtiles");
const MUNICIPALITIES_SOURCE_ID = "municipalities";
const MUNICIPALITIES_LAYER_ID = "municipalities-fill";

// INE census sections (pipelines/exposure census_sections.py, ADR-0024):
// the middle of three nested choropleth levels -- municipalities below
// SECTIONS_MINZOOM, sections from there to BUILDING_DETAIL_MINZOOM,
// buildings above. Same feature-state/filter pattern as municipalities,
// keyed by the 10-digit section `code`; colored from the scenario's
// section severities (getSectionSeverity). The selected municipality's
// sections (sidebar drill-down) also show below SECTIONS_MINZOOM, on their
// own layer, so a municipality too large to fit at z9 still shows them.
const SECTIONS_PMTILES_URL = staticDataUrl("sections.pmtiles");
const SECTIONS_SOURCE_ID = "sections";
const SECTIONS_LAYER_ID = "sections-fill";
const SECTIONS_FOCUS_LAYER_ID = "sections-focus-fill";
const SECTIONS_OUTLINE_LAYER_ID = "sections-selected-outline";
const MUNICIPALITY_FOCUS_OUTLINE_LAYER_ID = "municipalities-focus-outline";
const MUNICIPALITY_SELECTED_OUTLINE_LAYER_ID = "municipalities-selected-outline";
const SECTIONS_MINZOOM = 9;
// Where a section clicked in the sidebar is centered: as close as the map
// gets while still showing sections rather than individual buildings.
const SECTION_FOCUS_ZOOM = 11.5;

// Below this zoom: municipality/section choropleths, no individual
// buildings/debris (there are too many to usefully pick one out, and
// MERISUR-scale damage review starts at "which areas", not "which
// building"). At/above it: buildings + debris, no choropleth. Picked
// empirically once buildings render on screen -- no functional reason it
// has to be exactly 12 beyond "roughly neighbourhood scale" (it was 11
// until census sections took the zoom band just below it).
const BUILDING_DETAIL_MINZOOM = 12;

// Interpolated over `mean_severity` (the evaluated buildings' damage_state_code
// average, 0=all None .. 4=all Complete -- see its own feature-state comment
// below) through the *same* 5 DAMAGE_COLORS stops/order a single building's
// fill color is chosen from, not a separate 2-stop green->red gradient --
// so a municipality painted, say, "mostly orange" reads as "mostly Extensive"
// the same way an individual building painted orange does, rather than the
// two scales implying different severities for the same color.
const MUNICIPALITY_FILL_COLOR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["feature-state", "mean_severity"], 0],
  0,
  DAMAGE_COLORS.None,
  1,
  DAMAGE_COLORS.Slight,
  2,
  DAMAGE_COLORS.Moderate,
  3,
  DAMAGE_COLORS.Extensive,
  4,
  DAMAGE_COLORS.Complete,
];

// `damage_state_code` is a tile property once tile_join.py has joined this
// scenario's result onto a building's feature -- not present at all for
// the confidently-undamaged majority a scenario doesn't individually list
// (see scenarioApi.ts's own comment on BuildingDamageResult). `match`'s
// final argument is its fallback, used only if a joined feature somehow
// carried a code outside 0..4.
const BUILDING_DAMAGE_COLOR_EXPR = [
  "match",
  ["get", "damage_state_code"],
  ...DAMAGE_STATES.flatMap((state, index) => [index, DAMAGE_COLORS[state]]),
  DAMAGE_COLORS.Unknown,
] as unknown as maplibregl.ExpressionSpecification;

// A building with no joined `damage_state_code` is either outside this
// scenario's evaluated region (never assessed -- Unknown/grey) or inside it
// but not a close call (confidently undamaged -- None/green), same
// evaluated-circle distinction the popup makes (isWithinEvaluatedRegion).
// `null` (no scenario has run) falls back to Unknown everywhere.
function buildingsFillColor(
  evaluatedRegion: EvaluatedRegion | null
): maplibregl.ExpressionSpecification {
  const fallback: maplibregl.ExpressionSpecification | string = evaluatedRegion
    ? [
        "case",
        [
          "<",
          ["distance", { type: "Point", coordinates: [evaluatedRegion.lon, evaluatedRegion.lat] }],
          evaluatedRegion.radius_km * 1000,
        ],
        DAMAGE_COLORS.None,
        DAMAGE_COLORS.Unknown,
      ]
    : DAMAGE_COLORS.Unknown;
  return ["case", ["has", "damage_state_code"], BUILDING_DAMAGE_COLOR_EXPR, fallback];
}

// No scenario run yet -- the layer's own filter (set from
// `municipalityStats`, see its feature-state effect below) excludes every
// feature, matching this.
const NO_MUNICIPALITIES_FILTER: maplibregl.FilterSpecification = ["in", ["get", "ine_code"], ["literal", []]];
const NO_SECTIONS_FILTER: maplibregl.FilterSpecification = ["in", ["get", "code"], ["literal", []]];

// Faults are a plain GeoJSON source (not tiled): only 201 nationwide --
// nowhere near the scale that justifies PMTiles the way buildings.pmtiles
// does.
const FAULTS_SOURCE_ID = "faults";
const FAULTS_LAYER_ID = "faults-line";
const FAULTS_SELECTED_LAYER_ID = "faults-line-selected";

// A basemap (basemaps.ts) as what map.setStyle takes: Carto's vector
// styles by URL, raster ones as a one-source style.
function basemapStyle(basemap: Basemap, theme: Theme): string | StyleSpecification {
  return basemap.kind === "vector" ? basemap.styleUrl : rasterStyle(basemap, theme);
}

// Basemap switch: the new basemap's own sources/layers, plus every overlay
// source and layer twiner added to the old one (anything not from the old
// basemap's sources), on top as before. Glyphs are shared by every
// basemap, so MapLibre applies this as a diff -- the overlay sources are
// never reloaded and keep their feature-state (choropleths,
// infrastructure intensity, selection), filters and paint.
function keepOverlays(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
  previousBasemapSourceIds: Set<string>
): StyleSpecification {
  if (!previous) return next;
  const overlaySources = Object.fromEntries(
    Object.entries(previous.sources).filter(([id]) => !previousBasemapSourceIds.has(id))
  );
  const overlayLayers = previous.layers.filter(
    (layer) => "source" in layer && typeof layer.source === "string" && !previousBasemapSourceIds.has(layer.source)
  );
  return {
    ...next,
    sources: { ...next.sources, ...overlaySources },
    layers: [...next.layers, ...overlayLayers],
  };
}

// Mainland Spain, zoomed out enough to see most of it at once.
const SPAIN_CENTER: [number, number] = [-3.7038, 40.0];
const SPAIN_ZOOM = 5.3;

interface Props {
  // Keys the per-scenario tile-join endpoint (GET
  // /tiles/{scenario_id}/{z}/{x}/{y}.mvt, services/scenario/tile_join.py).
  // null before any scenario has run (or for the deployed-Lambda path,
  // which doesn't populate results_store.py yet) -- the buildings layer
  // then falls back to the plain static PMTiles archive, unjoined.
  scenarioId: string | null;
  // Server-computed aggregate stats per municipality (services/scenario's
  // compute_municipality_stats) -- drives the low-zoom choropleth. Always
  // `[]` (never absent) when a scenario has run but the backend had no
  // municipalities dataset available -- additive, not required.
  municipalityStats: MunicipalityStats[];
  // section_code -> mean severity (0-4), damaged sections only -- the
  // section choropleth's input. Empty before a scenario has run.
  sectionSeverity: Record<string, number>;
  // Sidebar drill-down: framed on the map when it changes, its sections
  // shown at any zoom, and its own choropleth fill hidden underneath them.
  selectedMunicipality: MunicipalityStats | null;
  // Sidebar section click: outlined, and centered at SECTION_FOCUS_ZOOM.
  selectedSection: SectionStats | null;
  // A clicked section's figures, for its popup (App.tsx caches per
  // municipality).
  loadSectionStats: (municipalityCode: string) => Promise<SectionStats[]>;
  evaluatedRegion: EvaluatedRegion | null;
  faults: Fault[] | null;
  selectedFaultId: string | null;
  // Which kind of scenario a map click starts. Automatic: faults are
  // hoverable (name + Mmax tooltip) and clickable (onFaultClick), other
  // clicks do nothing new. Manual: faults are display-only and every click
  // that doesn't hit a result layer goes to onMapClick.
  mode: "automatic" | "manual";
  // lat/lon here is the actual point clicked on the fault trace -- only
  // used as the rupture's reference point for a fault without full rupture
  // geometry (see scenarioApi.ts's runFaultScenario); every other fault's
  // rupture location comes from its own trace.
  onFaultClick: (faultId: string, lat: number, lon: number) => void;
  // Manual mode only: a click that hit no fault/building/debris/
  // municipality/section -- where the rupture popup opens.
  onMapClick: (lat: number, lon: number) => void;
  // The "run scenario" popup (App.tsx owns its content): anchored at
  // `lat`/`lon`, rendered through a React portal into a MapLibre popup.
  // A new `key` opens a new popup. null closes it; the user closing it
  // (× or a map click elsewhere) calls onRunPopupClose with its key --
  // a map click can open the next popup *before* the old one reports its
  // close, so App must only clear the popup whose key matches.
  runPopup: { key: number; lat: number; lon: number; content: ReactNode } | null;
  onRunPopupClose: (key: number) => void;
  // The legend's faults toggle: off hides the fault lines (so Automatic
  // mode has nothing to click until they're back).
  showFaults: boolean;
  // The legend's damage toggle: off hides the municipality/section
  // choropleths and debris and draws buildings uncoloured.
  showDamage: boolean;
  // ADR-0025. The scenario's intensity bands (null before a run or while
  // loading), drawn only while `showIntensity` (the legend's toggle).
  intensityBands: IntensityBands | null;
  showIntensity: boolean;
  // Infrastructure categories to draw (the panel's toggles; [] hides the
  // layer), and this scenario's affected assets, coloured by intensity.
  infrastructureCategories: string[];
  infrastructureResults: InfrastructureResult[] | null;
  // An asset picked in the sidebar: flown to, with its popup open. A new
  // `key` flies again even for the same asset.
  focusedAsset: { key: number; asset: InfrastructureResult } | null;
  // Real-time layers (ADR-0026): null data = layer off.
  dgtIncidents: DgtIncidents | null;
  dgtCategories: DgtCategory[];
  aemetObservations: AemetObservations | null;
  aemetMetric: AemetMetricKey;
  // AEMET warnings overlapping `warningWindow` ([start, end) epoch ms).
  aemetWarnings: AemetWarnings | null;
  warningWindow: [number, number];
  // Width of whatever floats over the map's right edge (the scenario
  // panel), in rem: the map is never resized for it, so the camera moves
  // below keep their targets clear of it instead.
  rightInsetRem: number;
  // basemaps.ts; the picker's choice, or the theme's Carto style.
  basemap: Basemap;
  // Called with the camera after every move (the basemap picker's
  // thumbnails show the area in view).
  onViewChange?: (view: View) => void;
  // Resolved UI theme: picks the overlay palette
  // (MAP_PALETTE).
  theme: Theme;
  // Popup text and numbers, in the current language.
  i18n: I18n;
  // The settings menu's zoom indicator toggle.
  showZoom: boolean;
}

// The API sends `damage_state_code`, the index into this same
// DAMAGE_STATES ordering (services/scenario/response.py), not a string --
// decode it back to a label/color here rather than shipping the string
// itself over the wire on every one of a few hundred thousand rows.
function damageStateLabel(code: number, i18n: I18n): string {
  const state = DAMAGE_STATES[code];
  return state ? i18n.t(`damage.${state}`) : "—";
}

// A popup's "label: value" line (value already escaped/HTML).
function popupRow(label: string, valueHtml: string): string {
  return `<div style="margin-bottom:2px"><span style="color:var(--text-muted)">${escapeHtml(label)}:</span> ${valueHtml}</div>`;
}

// Reconstructs a BuildingDamageResult straight from a clicked buildings
// tile feature's own properties (tile_join.py joins these in server-side,
// see this file's top-of-file docstring) -- null when this building wasn't
// a close call for the current scenario (no damage_state_code property at
// all, the ordinary case for the confidently-undamaged majority).
function tileDamageResult(
  buildingId: string,
  tileProps: Record<string, unknown>
): BuildingDamageResult | null {
  if (tileProps.damage_state_code === undefined) return null;
  return {
    building_id: buildingId,
    damage_state_code: Number(tileProps.damage_state_code),
    prob_none: Number(tileProps.prob_none),
    prob_slight: Number(tileProps.prob_slight),
    prob_moderate: Number(tileProps.prob_moderate),
    prob_extensive: Number(tileProps.prob_extensive),
    prob_complete: Number(tileProps.prob_complete),
  };
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function isWithinEvaluatedRegion(
  region: EvaluatedRegion | null,
  lat: number,
  lon: number
): boolean {
  if (!region) return false;
  return haversineKm(lat, lon, region.lat, region.lon) <= region.radius_km;
}

// Bounding box approximation of `region`'s circle, in the same style as
// the backend's own padded-box spatial pre-filter (engine.py's
// _load_sites: plain lat/lon degree padding, narrowing longitude by
// cos(lat) -- cheap, and always at least as wide as the true circle).
function boundsFromRegion(region: EvaluatedRegion): maplibregl.LngLatBounds {
  const kmPerDegreeLat = 111.0;
  const latPad = region.radius_km / kmPerDegreeLat;
  const lonPad =
    region.radius_km / (kmPerDegreeLat * Math.max(0.1, Math.abs(Math.cos((region.lat * Math.PI) / 180))));
  return new maplibregl.LngLatBounds(
    [region.lon - lonPad, region.lat - latPad],
    [region.lon + lonPad, region.lat + latPad]
  );
}

// Proportional-width stacked bar, one segment per damage class -- native
// `title=` gives the hover tooltip (name + percentage) for free, no JS
// wiring needed inside a Popup's detached DOM.
function renderProbabilityBar(damage: BuildingDamageResult, i18n: I18n): string {
  return renderProbabilityBarHtml(
    [damage.prob_none, damage.prob_slight, damage.prob_moderate, damage.prob_extensive, damage.prob_complete],
    i18n
  );
}

// Popup content for a clicked building: static exposure attributes come
// from two places -- floors/construction year/use/cadastral id (=
// building_id) are already on the clicked PMTiles feature itself (no
// request needed), while taxonomy_class/height_class only live in
// exposure.parquet and need the /buildings/{id} lookup (buildingInfo,
// still loading -> null while the request is in flight). Damage state
// comes off the clicked feature itself, joined in by the tile endpoint when
// this scenario listed the building (tileDamageResult).
function renderBuildingPopupHtml(
  tileProps: Record<string, unknown>,
  damage: BuildingDamageResult | null,
  withinEvaluatedRegion: boolean,
  buildingInfo: Record<string, unknown> | null | "loading",
  i18n: I18n
): string {
  const { t } = i18n;
  const rows: Array<[string, string]> = [
    [t("popup.floors"), escapeHtml(tileProps.floors)],
    [t("popup.built"), escapeHtml(tileProps.construction_year)],
    [t("popup.use"), escapeHtml(tileProps.current_use)],
  ];
  if (buildingInfo === "loading") {
    rows.push([t("popup.typology"), escapeHtml(t("common.loadingInline"))]);
  } else if (buildingInfo) {
    rows.push([t("popup.typology"), escapeHtml(buildingInfo.taxonomy_class)]);
    rows.push([t("popup.heightClass"), escapeHtml(buildingInfo.height_class)]);
  }

  let damageHtml: string;
  if (damage) {
    // This building was individually returned by the API -- either
    // actually damaged, or "None"-modal but still meaningfully uncertain
    // (a genuine close call against the runner-up damage state, see
    // scenarioApi.ts) -- either way we have its real probability
    // breakdown, unlike the not-a-close-call case below.
    const label = damageStateLabel(damage.damage_state_code, i18n);
    damageHtml =
      popupRow(t("popup.predictedDamage"), `<strong>${escapeHtml(label)}</strong>`) +
      renderProbabilityBar(damage, i18n);
  } else if (withinEvaluatedRegion) {
    // Inside the evaluated circle, but not individually listed -- the API
    // omitted it for being "None"-modal without a genuine close call
    // against another damage state, so no per-building probabilities are
    // available, just the summary.
    damageHtml = popupRow(t("popup.predictedDamage"), escapeHtml(t("popup.likelyNone")));
  } else {
    // Outside the evaluated circle (or no scenario has run at all) --
    // distinct from the confidently-undamaged case above: this building
    // was never assessed one way or the other.
    damageHtml = popupRow(t("popup.predictedDamage"), escapeHtml(t("common.notEvaluated")));
  }

  const body = rows.map(([label, value]) => popupRow(label, value)).join("");
  return (
    `<div style="font-size:0.8rem; max-width:16rem">` +
    `<h3 style="font-size:0.95rem; font-weight:600; margin:0 0 4px">${escapeHtml(tileProps.building_id)}</h3>` +
    `${body}${damageHtml}</div>`
  );
}

// Debris popup: only building_id + which ring (=which damage state first
// triggers it, ring N === DAMAGE_STATES[N] per debris.py's module
// docstring) -- no volume field exists yet (deferred, ADR-0010), so none is
// shown rather than fabricated.
function renderDebrisPopupHtml(tileProps: Record<string, unknown>, i18n: I18n): string {
  const ring = Number(tileProps.ring);
  const label = Number.isFinite(ring) ? damageStateLabel(ring, i18n) : "—";
  return (
    `<div style="font-size:0.8rem; max-width:16rem">` +
    `<h3 style="font-size:0.95rem; font-weight:600; margin:0 0 4px">${escapeHtml(tileProps.building_id)}</h3>` +
    popupRow(i18n.t("popup.debrisRing"), `${escapeHtml(ring)} (${escapeHtml(label)}+)`) +
    `</div>`
  );
}

// Municipality/section choropleth popup: name + the same impact figures
// the sidebar shows (impactRows), or a note when there are none.
function renderAreaPopupHtml(title: string, stats: AreaImpact | null | "loading", i18n: I18n): string {
  let body: string;
  if (stats === "loading") {
    body = `<div style="color:var(--text-muted)">${escapeHtml(i18n.t("common.loadingInline"))}</div>`;
  } else if (stats) {
    const total = stats.n_evaluated || 1;
    body =
      renderProbabilityBar({
        building_id: "",
        damage_state_code: 0,
        prob_none: stats.counts.None / total,
        prob_slight: stats.counts.Slight / total,
        prob_moderate: stats.counts.Moderate / total,
        prob_extensive: stats.counts.Extensive / total,
        prob_complete: stats.counts.Complete / total,
      }, i18n) +
      impactRows(stats, i18n)
        .map(
          (row) =>
            `<div style="margin-bottom:2px" title="${escapeHtml(row.hint)}"><span style="color:var(--text-muted)">${escapeHtml(row.label)}:</span> ${escapeHtml(row.value)}</div>`
        )
        .join("");
  } else {
    body = `<div style="color:var(--text-muted)">${escapeHtml(i18n.t("common.notEvaluated"))}</div>`;
  }
  return (
    `<div style="font-size:0.8rem; max-width:18rem">` +
    `<h3 style="font-size:0.95rem; font-weight:600; margin:0 0 4px">${escapeHtml(title)}</h3>` +
    body +
    `</div>`
  );
}

// Adds the buildings source + its two layers, pointed at either the
// per-scenario tile-join endpoint (scenarioId given -- tile_join.py joins
// this scenario's results into each tile's `buildings` features on the
// fly) or the plain static archive (scenarioId null -- before any scenario
// has run, or for a deployed backend without a results bucket, which doesn't populate
// results_store.py/expose this endpoint yet). Called both on initial map
// load and, again, whenever the source-swap effect below sees scenarioId
// actually change -- a vector source's tiles/url can't be swapped in place
// between a PMTiles archive and an XYZ tile endpoint, so this always
// removes+re-adds both the source and its layers rather than mutating one
// in place.
function addBuildingsSourceAndLayers(
  map: MapLibreMap,
  scenarioId: string | null,
  beforeId?: string
): void {
  map.addSource(BUILDINGS_SOURCE_ID, {
    type: "vector",
    ...(scenarioId
      ? {
          tiles: [`${TILES_API_URL}/tiles/${scenarioId}/{z}/{x}/{y}.mvt`],
          // A plain `tiles` array source has no TileJSON/PMTiles header to
          // read a real maxzoom from -- MapLibre defaults it to 22, which
          // made it request genuine z15+ tiles from tile_join.py instead
          // of overscaling the last real z14 one (confirmed: every z15+
          // request came back 204, since tile_join.py reads from this
          // same buildings.pmtiles archive, whose real max_zoom is 14 --
          // see the static-archive case's own maxzoom comment below).
          // Hardcoded to 14 rather than fetched from the archive at
          // runtime since it's the same constant either branch would need
          // to agree on.
          maxzoom: 14,
        }
      : { url: `pmtiles://${BUILDINGS_PMTILES_URL}` }),
    promoteId: "building_id",
    // Deliberately NOT overriding maxzoom for the static-archive case
    // (contrast debris.pmtiles' source below, also unoverridden) --
    // MapLibre already reads it from the PMTiles header itself, and
    // that's the right source of truth as long as the archive's own
    // metadata is honest. It currently isn't: buildings.pmtiles' header
    // claims maxzoom 15, but z15 is a uniformly empty ~27-byte tile
    // everywhere checked (10 major cities nationwide, not a regional
    // gap), and the file's own tilestats reports 63.2M buildings against
    // an expected ~12.9M (ADR-0010) -- a ~4.9x inflation, generator
    // "tile-join v2.79.0" rather than plain tippecanoe, pointing at a bad
    // merge, not a simple zoom-guess quirk. A hardcoded maxzoom:14
    // override was tried here first and did paper over the symptom, but
    // silently goes wrong again the moment this file is regenerated
    // correctly (caps detail below whatever the fixed archive can
    // actually support, with no error to catch it). The real fix belongs
    // in the data (see twiner-8a's fix-municipality-aggregation
    // investigation into this same file's building_id mismatches) --
    // once buildings.pmtiles is regenerated with an honest header, this
    // default (no override) is already correct with no frontend change
    // needed. The scenario tile-join endpoint reads tiles straight from
    // that same archive, so it shares whatever this ends up being.
  });
  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    type: "fill",
    source: BUILDINGS_SOURCE_ID,
    "source-layer": "buildings",
    minzoom: BUILDING_DETAIL_MINZOOM,
    paint: {
      // Grey ("Unknown") until a scenario has run -- updated to the
      // evaluated-region-aware expression once one has (see the
      // evaluatedRegion effect, buildingsFillColor). A joined
      // damage_state_code tile property always wins when present.
      "fill-color": buildingsFillColor(null),
      "fill-opacity": 0.85,
      "fill-outline-color": "#00000033",
    },
  }, beforeId);
  map.addLayer({
    id: BUILDINGS_OUTLINE_LAYER_ID,
    type: "line",
    source: BUILDINGS_SOURCE_ID,
    "source-layer": "buildings",
    minzoom: BUILDING_DETAIL_MINZOOM,
    paint: { "line-color": SELECTED_OUTLINE_PAINT, "line-width": 2.5 },
  }, beforeId);
}

// Debris envelopes (ADR-0010), same source-swap pattern as the buildings
// above: the plain static archive before any scenario has run, this
// scenario's debris tile-join endpoint after (ADR-0019). The joined tiles
// keep only each damaged building's one ring matching its
// damage_state_code, tagged with that code; the filter below shows exactly
// those, and hides every ring of the unjoined static archive (no
// damage_state_code property at all).
function addDebrisSourceAndLayers(
  map: MapLibreMap,
  scenarioId: string | null,
  color: string,
  beforeId?: string
): void {
  map.addSource(DEBRIS_SOURCE_ID, {
    type: "vector",
    ...(scenarioId
      ? {
          tiles: [`${TILES_API_URL}/tiles/${scenarioId}/debris/{z}/{x}/{y}.mvt`],
          // Same reason as the buildings tile-join source: a plain `tiles`
          // source has no header to read a maxzoom from. debris.pmtiles'
          // own header says 15.
          maxzoom: 15,
        }
      : { url: `pmtiles://${DEBRIS_PMTILES_URL}` }),
  });
  map.addLayer(
    {
      id: DEBRIS_LAYER_ID,
      type: "fill",
      source: DEBRIS_SOURCE_ID,
      "source-layer": "debris",
      minzoom: BUILDING_DETAIL_MINZOOM,
      // Only the ring matching a building's predicted damage state
      // (ring 1 = Slight .. ring 4 = Complete). Each ring is the
      // *cumulative* envelope out to its distance (debris.py), so that one
      // ring already covers what stacking rings 1..N would. A filter, not
      // a zero opacity, so hidden rings aren't hit-testable either.
      filter: ["==", ["get", "ring"], ["get", "damage_state_code"]],
      paint: { "fill-color": color, "fill-opacity": DEBRIS_RING_OPACITY },
    },
    beforeId
  );
  map.addLayer(
    {
      id: DEBRIS_OUTLINE_LAYER_ID,
      type: "line",
      source: DEBRIS_SOURCE_ID,
      "source-layer": "debris",
      minzoom: BUILDING_DETAIL_MINZOOM,
      // Selection highlight, filter-based on (building_id, ring) -- see
      // selectDebrisRing. Starts matching nothing.
      filter: ["==", ["get", "ring"], -1],
      paint: { "line-color": SELECTED_OUTLINE_COLOR, "line-width": 2.5 },
    },
    beforeId
  );
}

function faultsToFeatureCollection(faults: Fault[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: faults.map(
      (f): Feature => ({
        type: "Feature",
        properties: { fault_id: f.fault_id, name: f.name, mmax: f.mmax },
        geometry: JSON.parse(f.geometry_geojson) as Geometry,
      })
    ),
  };
}

export function DamageMap({
  scenarioId,
  municipalityStats,
  sectionSeverity,
  selectedMunicipality,
  selectedSection,
  loadSectionStats,
  evaluatedRegion,
  faults,
  selectedFaultId,
  mode,
  onFaultClick,
  onMapClick,
  runPopup,
  onRunPopupClose,
  showFaults,
  showDamage,
  intensityBands,
  showIntensity,
  infrastructureCategories,
  infrastructureResults,
  focusedAsset,
  dgtIncidents,
  dgtCategories,
  aemetObservations,
  aemetMetric: aemetMetricKey,
  aemetWarnings,
  warningWindow,
  rightInsetRem,
  basemap,
  onViewChange,
  theme,
  i18n,
  showZoom,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Debugging aid only (not tied to any rendering decision) -- lets
  // whoever's poking at zoom-dependent behavior (BUILDING_DETAIL_MINZOOM,
  // debris overzoom, tile density) read the current zoom off the map
  // itself instead of guessing from feel.
  const [zoom, setZoom] = useState<number | null>(null);
  const mapLoadedRef = useRef(false);
  // Which scenario_id (or null, meaning "no join, static archive") the
  // buildings source is currently pointed at -- lets the source-swap effect
  // below skip work when scenarioId hasn't actually changed.
  const buildingsSourceScenarioIdRef = useRef<string | null>(null);
  const loadedMunicipalityCodesRef = useRef<Set<string>>(new Set());
  const loadedSectionCodesRef = useRef<Set<string>>(new Set());
  // Codes of every damaged section (sectionSeverity's keys), for the two
  // section layers' filters -- kept so selecting a municipality can
  // re-filter without re-applying feature-state.
  const affectedSectionCodesRef = useRef<string[]>([]);
  const affectedMunicipalityCodesRef = useRef<string[]>([]);
  const selectedMunicipalityCodeRef = useRef<string | null>(null);
  selectedMunicipalityCodeRef.current = selectedMunicipality?.municipality_code ?? null;
  const loadSectionStatsRef = useRef(loadSectionStats);
  loadSectionStatsRef.current = loadSectionStats;
  // Municipality popup needs the latest stats (by municipality_code) to
  // show a clicked polygon's breakdown, without re-binding the click
  // handler -- same pattern as evaluatedRegionRef below.
  const municipalityStatsRef = useRef(municipalityStats);
  municipalityStatsRef.current = municipalityStats;
  // Click-to-highlight (buildings and debris share one selection -- a
  // debris ring click highlights its building_id the same as clicking the
  // building itself, since both layers key feature-state off the same id).
  // Only one source's "selected" state is ever set at a time; clearing it
  // before setting a new one keeps a stale highlight from lingering on a
  // previous source after a click elsewhere.
  const selectedRef = useRef<{ source: string; sourceLayer: string; id: string } | null>(null);
  // The selected infrastructure asset (asset_id), part of the same single
  // selection: selecting it clears a building/debris one and vice versa.
  const selectedAssetIdRef = useRef<number | null>(null);
  const selectInfraAsset = (id: number | null) => {
    const map = mapRef.current;
    if (!map) return;
    selectedAssetIdRef.current = selectAsset(map, selectedAssetIdRef.current, id);
  };
  // A selected municipality or census section, drawn by filtering the two
  // pink outline layers to its code (a map click, or for sections the
  // sidebar's pick too). Also part of the single selection.
  const selectedAreaRef = useRef<{ kind: "municipality" | "section"; code: string } | null>(null);
  const selectArea = (area: { kind: "municipality" | "section"; code: string } | null) => {
    const map = mapRef.current;
    if (!map) return;
    selectedAreaRef.current = area;
    map.setFilter(MUNICIPALITY_SELECTED_OUTLINE_LAYER_ID, [
      "==",
      ["get", "ine_code"],
      area?.kind === "municipality" ? area.code : "__none__",
    ]);
    map.setFilter(SECTIONS_OUTLINE_LAYER_ID, [
      "==",
      ["get", "code"],
      area?.kind === "section" ? area.code : "__none__",
    ]);
  };
  // The section the sidebar last selected, so deselecting it there only
  // clears the outline if a map click hasn't moved the selection since.
  const sidebarSectionCodeRef = useRef<string | null>(null);
  // Clears whatever is selected (set once the map has loaded), for the
  // sidebar picks below.
  const clearSelectionRef = useRef<() => void>(() => {});
  // Click/hover/move handlers are bound once (map.on is idempotent-unfriendly
  // to re-bind per render) but need the latest callback -- a ref sidesteps
  // stale closures without re-registering listeners on every render.
  const onFaultClickRef = useRef(onFaultClick);
  onFaultClickRef.current = onFaultClick;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onRunPopupCloseRef = useRef(onRunPopupClose);
  onRunPopupCloseRef.current = onRunPopupClose;
  // The run popup's MapLibre shell and the DOM node its React content is
  // portalled into (see the runPopup effect below).
  const [runPopupContainer, setRunPopupContainer] = useState<HTMLDivElement | null>(null);
  // Building-click popup needs the region a scenario was evaluated against
  // to classify a clicked building that has no joined damage_state_code
  // (see isWithinEvaluatedRegion) -- damage itself now comes straight off
  // the clicked tile feature's own properties (tile_join.py's join),
  // not a client-side results lookup.
  const evaluatedRegionRef = useRef(evaluatedRegion);
  evaluatedRegionRef.current = evaluatedRegion;
  const showDamageRef = useRef(showDamage);
  showDamageRef.current = showDamage;
  const rightInsetRemRef = useRef(rightInsetRem);
  rightInsetRemRef.current = rightInsetRem;
  // Camera helpers for the right inset: fitBounds padding (more on the
  // right), and an easeTo/flyTo offset that puts the target in the middle
  // of the uncovered part. Both per call -- map.setPadding would itself
  // move the view.
  const rightInsetPx = () =>
    rightInsetRemRef.current * parseFloat(getComputedStyle(document.documentElement).fontSize);
  const insetPadding = (px: number) => ({ top: px, bottom: px, left: px, right: px + rightInsetPx() });
  const insetOffset = (): [number, number] => [-rightInsetPx() / 2, 0];
  // Asset popups look up this scenario's row by id; the ids carrying
  // feature-state, to clear on the next scenario.
  const infrastructureByIdRef = useRef<Map<number, InfrastructureResult>>(new Map());
  // Popups are built in handlers bound once at load, so they read the
  // current language and palette through refs.
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // The theme the overlay palette currently uses (the theme effect skips a
  // no-op), and the basemap the map currently shows (basemapKey) with its
  // source ids -- how the next switch tells overlays from basemap.
  const paletteThemeRef = useRef(theme);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const basemapKey = basemap.kind === "raster" ? `${basemap.id}:${theme}` : basemap.id;
  const shownBasemapKeyRef = useRef(basemapKey);
  const basemapSourceIdsRef = useRef<Set<string>>(new Set());
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  // The basemap's English-name label fields, re-localized on a language
  // switch (basemapLabels.ts).
  const basemapLabelsRef = useRef<BasemapLabels>(new Map());
  const infrastructureStateIdsRef = useRef<Set<number>>(new Set());
  const aemetMetricRef = useRef(aemetMetricKey);
  aemetMetricRef.current = aemetMetricKey;
  const infrastructureResultsRef = useRef(infrastructureResults);
  infrastructureResultsRef.current = infrastructureResults;

  const faultsData = useMemo(
    () => (faults ? faultsToFeatureCollection(faults) : null),
    [faults]
  );

  useEffect(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: basemapStyle(basemapRef.current, themeRef.current),
      center: SPAIN_CENTER,
      zoom: SPAIN_ZOOM,
      // MapLibre v6 defaults to "splitting" (requesting literal deeper-zoom
      // tiles rather than immediately overscaling the last real one) for
      // zoomLevelsToOverscale=4 levels below the map's own maxZoom --
      // sensible for a live tile server that can generate detail beyond
      // its advertised maxzoom, wrong for a static PMTiles archive with a
      // real, hard ceiling (buildings.pmtiles: 15, debris.pmtiles: 16).
      // Those "split" requests land past the archive's actual max zoom,
      // and the pmtiles library returns a valid-but-empty MVT tile there
      // rather than signaling "fall back to the parent" -- MapLibre then
      // renders that empty tile as real content, so buildings/debris
      // vanish right past their own maxzoom instead of continuing to
      // overscale.
      //
      // The fix is NOT `0` (tried first, made it worse) -- per MapLibre's
      // own formula, the "split" zone runs from a source's maxzoom up to
      // `map.maxZoom - zoomLevelsToOverscale`, and only zoom levels above
      // that split all the way to `map.maxZoom` overscale. `0` collapses
      // the overscale zone to nothing and makes *every* zoom level past a
      // source's maxzoom split (worse than the default-4 behavior this
      // was meant to fix). To get "overscale immediately, no split zone
      // at all" for both sources regardless of their own maxzoom, this
      // needs to be >= `map.maxZoom - min(source maxzooms)` -- with the
      // default map.maxZoom of 22 and our lowest source maxzoom (15),
      // that's >= 7. Set generously past that so it holds even if a
      // future layer's maxzoom is lower still.
      zoomLevelsToOverscale: 22,
    });
    mapRef.current = map;

    map.on("load", () => {
      const palette = MAP_PALETTE[themeRef.current];

      // Basemap labels in the UI language. Captured now, while the style
      // holds nothing but the basemap.
      const basemap = map.getStyle();
      basemapSourceIdsRef.current = new Set(Object.keys(basemap.sources));
      basemapLabelsRef.current = collectBasemapLabels(basemap.layers, basemapSourceIdsRef.current);
      applyBasemapLanguage(map, basemapLabelsRef.current, i18nRef.current.lang);
      // Intensity bands (ADR-0025) first, so they sit under every
      // choropleth and building layer: context, not the result itself.
      addIntensityLayers(map);

      // Municipality choropleth (low zoom) -- added before buildings/debris
      // so it renders underneath them once both are visible near the
      // minzoom/maxzoom seam, though in practice only one of the two sets
      // is ever visible at a given zoom (see BUILDING_DETAIL_MINZOOM).
      map.addSource(MUNICIPALITIES_SOURCE_ID, {
        type: "vector",
        url: `pmtiles://${MUNICIPALITIES_PMTILES_URL}`,
        promoteId: "ine_code",
      });
      map.addLayer({
        id: MUNICIPALITIES_LAYER_ID,
        type: "fill",
        source: MUNICIPALITIES_SOURCE_ID,
        "source-layer": "municipalities",
        maxzoom: SECTIONS_MINZOOM,
        // No scenario has run at load time -- filter excludes every
        // feature until the municipalityStats effect below narrows it to
        // just the municipalities this scenario actually touched.
        filter: NO_MUNICIPALITIES_FILTER,
        paint: {
          "fill-color": MUNICIPALITY_FILL_COLOR,
          "fill-opacity": 0.75,
          "fill-outline-color": "#00000044",
        },
      });

      map.addSource(SECTIONS_SOURCE_ID, {
        type: "vector",
        url: `pmtiles://${SECTIONS_PMTILES_URL}`,
        promoteId: "code",
      });
      const sectionPaint = {
        "fill-color": MUNICIPALITY_FILL_COLOR,
        "fill-opacity": 0.75,
        "fill-outline-color": "#00000044",
      };
      map.addLayer({
        id: SECTIONS_LAYER_ID,
        type: "fill",
        source: SECTIONS_SOURCE_ID,
        "source-layer": "sections",
        minzoom: SECTIONS_MINZOOM,
        maxzoom: BUILDING_DETAIL_MINZOOM,
        filter: NO_SECTIONS_FILTER,
        paint: sectionPaint,
      });
      map.addLayer({
        id: SECTIONS_FOCUS_LAYER_ID,
        type: "fill",
        source: SECTIONS_SOURCE_ID,
        "source-layer": "sections",
        maxzoom: SECTIONS_MINZOOM,
        filter: NO_SECTIONS_FILTER,
        paint: sectionPaint,
      });
      map.addLayer({
        id: SECTIONS_OUTLINE_LAYER_ID,
        type: "line",
        source: SECTIONS_SOURCE_ID,
        "source-layer": "sections",
        maxzoom: BUILDING_DETAIL_MINZOOM,
        filter: ["==", ["get", "code"], "__none__"],
        paint: { "line-color": SELECTED_OUTLINE_COLOR, "line-width": 2.5 },
      });
      map.addLayer({
        id: MUNICIPALITY_FOCUS_OUTLINE_LAYER_ID,
        type: "line",
        source: MUNICIPALITIES_SOURCE_ID,
        "source-layer": "municipalities",
        filter: ["==", ["get", "ine_code"], "__none__"],
        paint: { "line-color": palette.focusOutline, "line-width": 2 },
      });
      // Click-to-highlight for a municipality (selectArea): above the
      // drill-down focus outline, at every zoom. Starts matching nothing.
      map.addLayer({
        id: MUNICIPALITY_SELECTED_OUTLINE_LAYER_ID,
        type: "line",
        source: MUNICIPALITIES_SOURCE_ID,
        "source-layer": "municipalities",
        filter: ["==", ["get", "ine_code"], "__none__"],
        paint: { "line-color": SELECTED_OUTLINE_COLOR, "line-width": 2.5 },
      });

      addBuildingsSourceAndLayers(map, null);
      buildingsSourceScenarioIdRef.current = null;

      addDebrisSourceAndLayers(map, null, palette.debris);

      // Critical infrastructure (ADR-0025): above buildings and debris,
      // below the fault lines. Hidden until a category is toggled on.
      addInfrastructureLayers(map, themeRef.current);
      // Real-time layers (ADR-0026): above the scenario's, below faults.
      addRealtimeLayers(map, themeRef.current);

      map.addSource(FAULTS_SOURCE_ID, {
        type: "geojson",
        data: faultsData ?? { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: FAULTS_LAYER_ID,
        type: "line",
        source: FAULTS_SOURCE_ID,
        paint: { "line-color": palette.fault, "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: FAULTS_SELECTED_LAYER_ID,
        type: "line",
        source: FAULTS_SOURCE_ID,
        filter: ["==", ["get", "fault_id"], "__none__"],
        paint: { "line-color": palette.fault, "line-width": 4 },
      });

      // Automatic mode: hovering a fault names it; clicking opens its run
      // popup (App.tsx). Manual mode leaves fault lines inert so a click on
      // one sets the rupture location like anywhere else.
      const faultTooltip = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "fault-tooltip",
        offset: 8,
        maxWidth: "none",
      });
      map.on("click", FAULTS_LAYER_ID, (e: MapLayerMouseEvent) => {
        if (modeRef.current !== "automatic") return;
        const faultId = e.features?.[0]?.properties?.fault_id;
        if (!faultId) return;
        faultTooltip.remove();
        onFaultClickRef.current(faultId, e.lngLat.lat, e.lngLat.lng);
      });
      map.on("mousemove", FAULTS_LAYER_ID, (e: MapLayerMouseEvent) => {
        if (modeRef.current !== "automatic") return;
        const props = e.features?.[0]?.properties;
        if (!props) return;
        map.getCanvas().style.cursor = "pointer";
        faultTooltip
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${escapeHtml(props.name)}</strong> · Mmax ${escapeHtml(i18nRef.current.fmtDecimal(Number(props.mmax)))}`
          )
          .addTo(map);
      });
      map.on("mouseleave", FAULTS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        faultTooltip.remove();
      });

      // Click-to-highlight: buildings and debris share one selection at a
      // time (selecting one clears the other), but use different
      // mechanisms. Buildings use feature-state, since a building's
      // building_id is unique per feature there. Debris can't: its
      // promoteId is building_id shared across all 4 of a building's ring
      // features on purpose (one setFeatureState drives every ring's
      // damage_state_code-gated visibility at once, see the source comment
      // above) -- a "selected" feature-state would light up every ring of
      // the clicked building, not just the one clicked. The debris outline
      // layer is filtered on (building_id, ring) together instead, which
      // only ever matches the single clicked ring feature.
      const clearBuildingSelection = () => {
        if (!selectedRef.current) return;
        map.setFeatureState(selectedRef.current, { selected: false });
        selectedRef.current = null;
      };
      const selectBuilding = (id: string) => {
        clearBuildingSelection();
        clearDebrisSelection();
        selectInfraAsset(null);
        const target = { source: BUILDINGS_SOURCE_ID, sourceLayer: "buildings", id };
        map.setFeatureState(target, { selected: true });
        selectedRef.current = target;
      };
      const clearDebrisSelection = () => {
        map.setFilter(DEBRIS_OUTLINE_LAYER_ID, ["==", ["get", "ring"], -1]);
      };
      const selectDebrisRing = (buildingId: string, ring: number) => {
        clearBuildingSelection();
        selectInfraAsset(null);
        map.setFilter(DEBRIS_OUTLINE_LAYER_ID, [
          "all",
          ["==", ["get", "building_id"], buildingId],
          ["==", ["get", "ring"], ring],
        ]);
      };
      const clearSelection = () => {
        clearBuildingSelection();
        clearDebrisSelection();
        selectInfraAsset(null);
        selectArea(null);
      };
      clearSelectionRef.current = clearSelection;

      // Building click popup: floors/construction year/use/cadastral id
      // come straight off the clicked tile feature (no request needed);
      // taxonomy/height class need a /buildings/{id} lookup, and damage
      // comes off the clicked (tile-joined) feature itself (tileDamageResult).
      // Registered before the generic "click anywhere" handler below so a
      // building click never also falls through to onMapClick (that
      // handler checks queryRenderedFeatures itself and skips when this
      // layer was hit, but ordering here keeps the popup responsive first).
      map.on("click", BUILDINGS_LAYER_ID, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const tileProps = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingId = tileProps.building_id as string | undefined;
        if (!buildingId) return;

        selectBuilding(buildingId);

        const damage = tileDamageResult(buildingId, tileProps);
        const withinEvaluatedRegion = isWithinEvaluatedRegion(
          evaluatedRegionRef.current,
          e.lngLat.lat,
          e.lngLat.lng
        );
        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "18rem" })
          .setLngLat(e.lngLat)
          .setHTML(renderBuildingPopupHtml(tileProps, damage, withinEvaluatedRegion, "loading", i18nRef.current))
          .addTo(map);

        getBuildingInfo(buildingId)
          .then((info) => {
            if (popup.isOpen())
              popup.setHTML(
                renderBuildingPopupHtml(tileProps, damage, withinEvaluatedRegion, info, i18nRef.current)
              );
          })
          .catch(() => {
            // Lookup failure shouldn't kill the popup -- just drop the
            // taxonomy/height rows, tile-derived info still shows.
            if (popup.isOpen())
              popup.setHTML(
                renderBuildingPopupHtml(tileProps, damage, withinEvaluatedRegion, null, i18nRef.current)
              );
          });
      });
      map.on("mouseenter", BUILDINGS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", BUILDINGS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      // Debris click popup: building_id + ring only (no volume field yet,
      // see renderDebrisPopupHtml) -- same selection/highlight treatment as
      // a building click, registered before the generic map-click handler
      // for the same reason.
      map.on("click", DEBRIS_LAYER_ID, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const tileProps = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingId = tileProps.building_id as string | undefined;
        const ring = Number(tileProps.ring);
        if (!buildingId || !Number.isFinite(ring)) return;

        // The layer's filter already hides (and so un-hit-tests) every ring
        // but the one matching the building's joined damage_state_code --
        // re-checked here only as a guard against a static-archive tile.
        if (ring !== Number(tileProps.damage_state_code)) return;

        selectDebrisRing(buildingId, ring);

        new maplibregl.Popup({ closeButton: true, maxWidth: "18rem" })
          .setLngLat(e.lngLat)
          .setHTML(renderDebrisPopupHtml(tileProps, i18nRef.current))
          .addTo(map);
      });
      map.on("mouseenter", DEBRIS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", DEBRIS_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      // Municipality choropleth click popup -- name + aggregate stats, if
      // this municipality has any (municipalityStatsRef, keyed by
      // municipality_code === the tile's own ine_code).
      map.on("click", MUNICIPALITIES_LAYER_ID, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const tileProps = (feature.properties ?? {}) as Record<string, unknown>;
        const ineCode = tileProps.ine_code as string | undefined;
        if (!ineCode) return;
        clearSelection();
        selectArea({ kind: "municipality", code: ineCode });

        const stats =
          municipalityStatsRef.current?.find((m) => m.municipality_code === ineCode) ?? null;
        new maplibregl.Popup({ closeButton: true, maxWidth: "20rem" })
          .setLngLat(e.lngLat)
          .setHTML(renderAreaPopupHtml(String(tileProps.name ?? ineCode), stats, i18nRef.current))
          .addTo(map);
      });

      // Census section popup: its figures are fetched per municipality
      // (loadSectionStats, cached in App.tsx), so the popup opens at once
      // and fills in.
      const onSectionClick = (e: MapLayerMouseEvent) => {
        const tileProps = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
        const code = tileProps.code as string | undefined;
        if (!code) return;
        clearSelection();
        selectArea({ kind: "section", code });
        const i18n = i18nRef.current;
        const title = i18n.t("popup.sectionTitle", {
          municipality: String(tileProps.municipality_name ?? code.slice(0, 5)),
          label: `${code.slice(5, 7)}-${code.slice(7)}`,
        });
        const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "20rem" })
          .setLngLat(e.lngLat)
          .setHTML(renderAreaPopupHtml(title, "loading", i18n))
          .addTo(map);
        loadSectionStatsRef.current(code.slice(0, 5))
          .then((rows) => {
            if (popup.isOpen())
              popup.setHTML(renderAreaPopupHtml(title, rows.find((r) => r.section_code === code) ?? null, i18n));
          })
          .catch(() => {
            if (popup.isOpen()) popup.setHTML(renderAreaPopupHtml(title, null, i18n));
          });
      };
      for (const layerId of [SECTIONS_LAYER_ID, SECTIONS_FOCUS_LAYER_ID]) {
        map.on("click", layerId, onSectionClick);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      map.on("mouseenter", MUNICIPALITIES_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", MUNICIPALITIES_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      // Infrastructure asset popup: static attributes off the tile, this
      // scenario's intensity (and building damage) when it flagged the asset.
      for (const layerId of INFRA_CLICKABLE_LAYER_IDS) {
        map.on("click", layerId, (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const tileProps = (feature.properties ?? {}) as Record<string, unknown>;
          const assetId = Number(feature.id ?? tileProps.asset_id);
          clearSelection();
          selectInfraAsset(assetId);
          const region = evaluatedRegionRef.current;
          new maplibregl.Popup({ closeButton: true, maxWidth: "20rem" })
            .setLngLat(e.lngLat)
            .setHTML(
              renderInfrastructurePopupHtml(
                tileProps,
                infrastructureByIdRef.current.get(assetId) ?? null,
                region
                  ? { withinEvaluatedRegion: isWithinEvaluatedRegion(region, e.lngLat.lat, e.lngLat.lng) }
                  : null,
                i18nRef.current
              )
            )
            .addTo(map);
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // Real-time layers: a popup with the incident's / station's reading.
      const realtimePopups: Array<[string, (props: Record<string, unknown>) => string]> = [
        [DGT_LAYER_ID, (props) => renderDgtPopupHtml(props, i18nRef.current)],
        [DGT_LINE_LAYER_ID, (props) => renderDgtPopupHtml(props, i18nRef.current)],
        [AEMET_LAYER_ID, (props) => renderAemetPopupHtml(props, aemetMetric(aemetMetricRef.current), i18nRef.current)],
      ];
      for (const [layerId, render] of realtimePopups) {
        map.on("click", layerId, (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature) return;
          clearSelection();
          // A marker's popup sits on the marker; a stretch's where clicked.
          const at: [number, number] =
            feature.geometry.type === "Point"
              ? ((feature.geometry as Point).coordinates as [number, number])
              : [e.lngLat.lng, e.lngLat.lat];
          new maplibregl.Popup({ closeButton: true, maxWidth: "20rem" })
            .setLngLat(at)
            .setHTML(render((feature.properties ?? {}) as Record<string, unknown>))
            .addTo(map);
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // General map click (manual mode's rupture popup) -- skips clicks
      // that landed on a building, debris ring, municipality or section
      // (handled by their own popup click handlers above), and on a fault
      // line in automatic mode, so one click doesn't trigger two different
      // behaviors at once; clears any highlight since this click hit none
      // of them. Never switches mode itself: onMapClick only fires in
      // manual mode; in automatic mode the click can open AEMET warnings.
      map.on("click", (e: MapLayerMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: [
            ...(modeRef.current === "automatic" ? [FAULTS_LAYER_ID] : []),
            BUILDINGS_LAYER_ID,
            DEBRIS_LAYER_ID,
            MUNICIPALITIES_LAYER_ID,
            SECTIONS_LAYER_ID,
            SECTIONS_FOCUS_LAYER_ID,
            ...[...INFRA_CLICKABLE_LAYER_IDS, ...REALTIME_CLICKABLE_LAYER_IDS].filter(
              (id) => map.getLayoutProperty(id, "visibility") !== "none"
            ),
          ],
        });
        if (hits.length === 0) {
          clearSelection();
          if (modeRef.current === "manual") {
            onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
            return;
          }
          // AEMET warnings (ADR-0026) cover whole forecast zones, so they
          // only answer a click nothing else took, and never in Manual
          // mode, where a click places the earthquake.
          if (map.getLayoutProperty(WARNINGS_FILL_LAYER_ID, "visibility") === "none") return;
          const warnings = map.queryRenderedFeatures(e.point, { layers: [WARNINGS_FILL_LAYER_ID] });
          if (warnings.length === 0) return;
          new maplibregl.Popup({ closeButton: true, maxWidth: "22rem" })
            .setLngLat(e.lngLat)
            .setHTML(
              renderWarningsPopupHtml(
                warnings.map((w) => (w.properties ?? {}) as Record<string, unknown>),
                i18nRef.current
              )
            )
            .addTo(map);
        }
      });

      const reportZoom = () => setZoom(map.getZoom());
      map.on("zoom", reportZoom);
      reportZoom();
      const reportView = () => {
        const { lng, lat } = map.getCenter();
        onViewChangeRef.current?.({ lng, lat, zoom: map.getZoom() });
      };
      map.on("moveend", reportView);
      reportView();

      mapLoadedRef.current = true;
    });

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      maplibregl.removeProtocol("pmtiles");
    };
  }, []);

  // Which municipalities/sections render at all: only damaged ones (see
  // the municipality effect above for why), minus the selected
  // municipality's own fill, plus its sections at every zoom.
  function applyAreaFilters(map: MapLibreMap) {
    const selected = selectedMunicipalityCodeRef.current;
    const municipalities = affectedMunicipalityCodesRef.current.filter((c) => c !== selected);
    const sections = affectedSectionCodesRef.current;
    map.setFilter(
      MUNICIPALITIES_LAYER_ID,
      municipalities.length === 0
        ? NO_MUNICIPALITIES_FILTER
        : ["in", ["get", "ine_code"], ["literal", municipalities]]
    );
    map.setFilter(
      SECTIONS_LAYER_ID,
      sections.length === 0 ? NO_SECTIONS_FILTER : ["in", ["get", "code"], ["literal", sections]]
    );
    const focus = selected ? sections.filter((c) => c.startsWith(selected)) : [];
    map.setFilter(
      SECTIONS_FOCUS_LAYER_ID,
      focus.length === 0 ? NO_SECTIONS_FILTER : ["in", ["get", "code"], ["literal", focus]]
    );
  }

  // The damage toggle (showDamageRef): buildings coloured by damage or
  // uniformly "not evaluated" grey, choropleths and debris shown or hidden.
  // Re-applied after every buildings/debris source swap, which re-adds
  // those layers with their default paint and visibility.
  function applyDamageLayers(map: MapLibreMap) {
    const show = showDamageRef.current;
    map.setPaintProperty(
      BUILDINGS_LAYER_ID,
      "fill-color",
      show ? buildingsFillColor(evaluatedRegionRef.current) : DAMAGE_COLORS.Unknown
    );
    for (const layerId of [
      MUNICIPALITIES_LAYER_ID,
      SECTIONS_LAYER_ID,
      SECTIONS_FOCUS_LAYER_ID,
      DEBRIS_LAYER_ID,
      DEBRIS_OUTLINE_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", show ? "visible" : "none");
    }
  }

  // Run popup: one MapLibre popup per anchor point, whose DOM node the
  // React content is portalled into (so it stays a live React form, not
  // HTML set once). Closing it from the map (× or a click elsewhere)
  // reports back through onRunPopupClose; closing it from App (null)
  // removes it without that callback.
  const runPopupKey = runPopup?.key;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !runPopup) return;
    const { key, lat, lon } = runPopup;
    const container = document.createElement("div");
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "20rem", className: "run-popup" })
      .setLngLat([lon, lat])
      .setDOMContent(container)
      .addTo(map);
    let closedByApp = false;
    popup.on("close", () => {
      if (!closedByApp) onRunPopupCloseRef.current(key);
    });
    setRunPopupContainer(container);
    return () => {
      closedByApp = true;
      popup.remove();
      setRunPopupContainer(null);
    };
    // Keyed on `key` alone: content changes (form edits) re-render
    // through the portal without recreating the popup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPopupKey]);

  // Faults data can arrive (or change) after the map has already loaded --
  // update the source in place rather than requiring load-order luck.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !faultsData) return;

    const applyFaultsData = () => {
      (map.getSource(FAULTS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(faultsData);
    };
    if (mapLoadedRef.current) {
      applyFaultsData();
    } else {
      map.once("load", applyFaultsData);
    }
  }, [faultsData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    map.setFilter(FAULTS_SELECTED_LAYER_ID, [
      "==",
      ["get", "fault_id"],
      selectedFaultId ?? "__none__",
    ]);
  }, [selectedFaultId]);

  // Swap the buildings and debris sources to this scenario's tile-join
  // endpoints once one has run (or back to the plain static archives when
  // it hasn't -- e.g. a fresh page load). Replaces the old per-building
  // setFeatureState loops entirely: damage is joined onto each tile
  // server-side (ADR-0017 buildings, ADR-0019 debris), so there's no
  // client-side pass left to do, and no per-building list to download, at
  // any scenario size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    if (buildingsSourceScenarioIdRef.current === scenarioId) return;
    buildingsSourceScenarioIdRef.current = scenarioId;

    for (const layerId of [
      DEBRIS_OUTLINE_LAYER_ID,
      DEBRIS_LAYER_ID,
      BUILDINGS_OUTLINE_LAYER_ID,
      BUILDINGS_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }
    for (const sourceId of [DEBRIS_SOURCE_ID, BUILDINGS_SOURCE_ID]) {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
    // Re-inserted beneath infrastructure and the fault lines, same stacking
    // as the initial load (municipalities < buildings < debris <
    // infrastructure < faults) -- addLayer without a beforeId would put
    // them on top of everything.
    const beforeId = map.getLayer(INFRA_SHAPES_FILL_LAYER_ID)
      ? INFRA_SHAPES_FILL_LAYER_ID
      : map.getLayer(FAULTS_LAYER_ID)
        ? FAULTS_LAYER_ID
        : undefined;
    addBuildingsSourceAndLayers(map, scenarioId, beforeId);
    addDebrisSourceAndLayers(map, scenarioId, MAP_PALETTE[themeRef.current].debris, beforeId);
    // A source swap drops any feature-state the removed source held --
    // the previous selection highlight (if any) no longer refers to a
    // feature that still exists, so forget it rather than leaving a
    // dangling ref that clearBuildingSelection would act on uselessly.
    selectedRef.current = null;
    // A selected municipality/section belongs to the old result's
    // choropleth, gone now too.
    selectArea(null);

    applyDamageLayers(map);
  }, [scenarioId]);

  // Municipality choropleth: same feature-state pattern, keyed by
  // municipality_code (== the tile's own ine_code, promoted as its id).
  // `n_affected` is precomputed here (n_evaluated - the None count) rather
  // than in the paint expression, since GL expressions can't easily reach
  // into a feature-state object's own sub-fields the way JS can.
  //
  // The layer's `filter` is also driven from here (not just feature-state)
  // -- unlike buildings/debris, this is ~8,200 features nationwide, and a
  // municipality with no actual damage should neither render (a grey box
  // over all of Spain before any scenario has run, or over every
  // municipality merely inside the scenario's search radius but otherwise
  // unaffected) nor be clickable (a filtered-out feature is excluded from
  // queryRenderedFeatures too, unlike fill-opacity 0, which still
  // hit-tests). See the n_affected filtering below for why "evaluated"
  // alone isn't the right bar.
  useEffect(() => {
    const map = mapRef.current;
    // Needed (unlike a plain setFeatureState call, which is harmless
    // before the layer exists) because this effect also
    // calls setFilter on MUNICIPALITIES_LAYER_ID -- that layer doesn't
    // exist until the map's "load" handler runs addLayer, so without this
    // guard a `municipalityStats` update landing before then
    // (e.g. this effect's own first run, since mapRef.current is already
    // set synchronously in the map-creation effect above, well before its
    // async "load" event fires) subscribes to the next "sourcedata" event
    // -- which can fire for the *basemap's own* sources first -- and
    // throws "Cannot filter non-existing layer" when it does. Same guard
    // the faults-filter effect below already uses for the same reason.
    if (!map || !mapLoadedRef.current) return;

    const applyMunicipalityFeatureState = () => {
      const target = { source: MUNICIPALITIES_SOURCE_ID, sourceLayer: "municipalities" };

      for (const code of loadedMunicipalityCodesRef.current) {
        map.removeFeatureState({ ...target, id: code });
      }
      loadedMunicipalityCodesRef.current = new Set();

      // Only municipalities with at least one actually-damaged building
      // (not just "inside the scenario's search radius") get shown --
      // engine.py's spatial pre-filter box is sized off the rupture's own
      // magnitude, not proximity to any particular municipality, so a big
      // enough earthquake can pull in and evaluate municipalities far from
      // the epicenter as confidently-undamaged (n_evaluated > 0, n_affected
      // == 0). Those aren't what "affected" means here.
      const affectedCodes: string[] = [];
      for (const stats of municipalityStats) {
        const nAffected = stats.n_evaluated - stats.counts.None;
        if (nAffected <= 0) continue;
        map.setFeatureState(
          { ...target, id: stats.municipality_code },
          { n_evaluated: stats.n_evaluated, n_affected: nAffected, mean_severity: meanSeverity(stats) }
        );
        loadedMunicipalityCodesRef.current.add(stats.municipality_code);
        affectedCodes.push(stats.municipality_code);
      }

      affectedMunicipalityCodesRef.current = affectedCodes;
      applyAreaFilters(map);
    };

    if (map.isSourceLoaded(MUNICIPALITIES_SOURCE_ID)) {
      applyMunicipalityFeatureState();
    } else {
      map.once("sourcedata", applyMunicipalityFeatureState);
    }
  }, [municipalityStats]);

  // Section choropleth: feature-state per damaged section, same pattern as
  // municipalities above; the filters (which sections show at all) are
  // applied by applyAreaFilters, shared with the selection effect below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const applySectionFeatureState = () => {
      const target = { source: SECTIONS_SOURCE_ID, sourceLayer: "sections" };
      for (const code of loadedSectionCodesRef.current) {
        map.removeFeatureState({ ...target, id: code });
      }
      loadedSectionCodesRef.current = new Set(Object.keys(sectionSeverity));
      for (const [code, severity] of Object.entries(sectionSeverity)) {
        map.setFeatureState({ ...target, id: code }, { mean_severity: severity });
      }
      affectedSectionCodesRef.current = Object.keys(sectionSeverity);
      applyAreaFilters(map);
    };

    if (map.isSourceLoaded(SECTIONS_SOURCE_ID)) {
      applySectionFeatureState();
    } else {
      map.once("sourcedata", applySectionFeatureState);
    }
  }, [sectionSeverity]);

  // Sidebar drill-down: frame the municipality at section level (capped
  // below BUILDING_DETAIL_MINZOOM so sections, not buildings, are what
  // shows; a municipality too big for SECTIONS_MINZOOM gets the focus
  // layer instead), outline it, and hide its own fill under its sections.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyAreaFilters(map);
    map.setFilter(MUNICIPALITY_FOCUS_OUTLINE_LAYER_ID, [
      "==",
      ["get", "ine_code"],
      selectedMunicipality?.municipality_code ?? "__none__",
    ]);
    if (selectedMunicipality?.bbox) {
      const [west, south, east, north] = selectedMunicipality.bbox;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: insetPadding(40), maxZoom: BUILDING_DETAIL_MINZOOM - 0.5, duration: 600 }
      );
    }
  }, [selectedMunicipality]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const code = selectedSection?.section_code ?? null;
    if (code) {
      clearSelectionRef.current();
      selectArea({ kind: "section", code });
    } else if (
      selectedAreaRef.current?.kind === "section" &&
      selectedAreaRef.current.code === sidebarSectionCodeRef.current
    ) {
      selectArea(null);
    }
    sidebarSectionCodeRef.current = code;
    if (selectedSection?.bbox) {
      const [west, south, east, north] = selectedSection.bbox;
      map.easeTo({
        center: [(west + east) / 2, (south + north) / 2],
        zoom: SECTION_FOCUS_ZOOM,
        offset: insetOffset(),
        duration: 600,
      });
    }
  }, [selectedSection]);

  // Everything else a scenario run changes: the fallback color for
  // buildings with no joined damage_state_code (green inside the evaluated
  // circle, grey outside it -- computed per-feature on the GPU via the
  // `distance` expression, so this scales with what's on screen, not with
  // how many buildings the search radius actually covers -- see
  // buildingsFillColor) and the viewport, framed to the evaluated circle so
  // "affected" buildings (green included) are in view without pulling in
  // unrelated grey ones.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    applyDamageLayers(map);

    if (evaluatedRegion) {
      map.fitBounds(boundsFromRegion(evaluatedRegion), {
        padding: insetPadding(48),
        maxZoom: 15,
        duration: 500,
      });
    }
  }, [evaluatedRegion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyDamageLayers(map);
  }, [showDamage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const layerId of [FAULTS_LAYER_ID, FAULTS_SELECTED_LAYER_ID]) {
        map.setLayoutProperty(layerId, "visibility", showFaults ? "visible" : "none");
      }
    };
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [showFaults]);

  // Sidebar asset pick: fly there (at least building zoom, so its building
  // and shape show) and open the same popup a map click would.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !focusedAsset) return;
    const { asset } = focusedAsset;
    clearSelectionRef.current();
    selectInfraAsset(asset.asset_id);
    map.flyTo({
      center: [asset.lon, asset.lat],
      zoom: Math.max(map.getZoom(), 15),
      offset: insetOffset(),
      duration: 800,
    });
    const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "20rem" })
      .setLngLat([asset.lon, asset.lat])
      .setHTML(
        renderInfrastructurePopupHtml(
          { name: asset.name, subtype: asset.subtype, category: asset.category },
          asset,
          { withinEvaluatedRegion: true },
          i18nRef.current
        )
      )
      .addTo(map);
    return () => {
      popup.remove();
    };
  }, [focusedAsset]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setIntensityBands(map, intensityBands, showIntensity);
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [intensityBands, showIntensity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setInfrastructureCategories(map, infrastructureCategories);
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [infrastructureCategories]);

  useEffect(() => {
    const map = mapRef.current;
    infrastructureByIdRef.current = new Map((infrastructureResults ?? []).map((r) => [r.asset_id, r]));
    if (!map) return;
    const apply = () => {
      infrastructureStateIdsRef.current = applyInfrastructureResults(
        map,
        infrastructureStateIdsRef.current,
        infrastructureResults,
        themeRef.current
      );
    };
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [infrastructureResults]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setDgtIncidents(map, dgtIncidents, dgtCategories);
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [dgtIncidents, dgtCategories]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setAemetStations(map, aemetObservations, aemetMetric(aemetMetricKey), i18n.locale);
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [aemetObservations, aemetMetricKey, i18n.locale]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => setAemetWarnings(map, aemetWarnings, warningWindow);
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [aemetWarnings, warningWindow]);

  // Theme switch: recolour the overlays whose colours depend on it
  // (MAP_PALETTE). The basemap itself is the effect after this one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || paletteThemeRef.current === theme) return;
    const apply = () => {
      paletteThemeRef.current = theme;
      const palette = MAP_PALETTE[theme];
      map.setPaintProperty(FAULTS_LAYER_ID, "line-color", palette.fault);
      map.setPaintProperty(FAULTS_SELECTED_LAYER_ID, "line-color", palette.fault);
      map.setPaintProperty(MUNICIPALITY_FOCUS_OUTLINE_LAYER_ID, "line-color", palette.focusOutline);
      if (map.getLayer(DEBRIS_LAYER_ID)) map.setPaintProperty(DEBRIS_LAYER_ID, "fill-color", palette.debris);
      setInfrastructurePaint(map, infrastructureResultsRef.current !== null, theme);
      setRealtimePaint(map, theme);
    };
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [theme]);

  // Basemap switch (the picker, or the theme while it follows the theme):
  // swap it in place under the overlays (keepOverlays).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownBasemapKeyRef.current === basemapKey) return;
    const apply = () => {
      shownBasemapKeyRef.current = basemapKey;
      map.setStyle(basemapStyle(basemapRef.current, themeRef.current), {
        transformStyle: (previous, next) => {
          const merged = keepOverlays(previous, next, basemapSourceIdsRef.current);
          basemapSourceIdsRef.current = new Set(Object.keys(next.sources));
          // The new basemap's labels, in the current language.
          basemapLabelsRef.current = collectBasemapLabels(next.layers, basemapSourceIdsRef.current);
          return { ...merged, layers: localizeLayers(merged.layers, basemapLabelsRef.current, i18nRef.current.lang) };
        },
      });
    };
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
  }, [basemapKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyBasemapLanguage(map, basemapLabelsRef.current, i18n.lang);
  }, [i18n.lang]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {runPopup && runPopupContainer && createPortal(runPopup.content, runPopupContainer)}
      {showZoom && zoom !== null && (
        // Under the settings gear (App.tsx), which switches it on.
        <div
          style={{
            position: "absolute",
            top: "3.4rem",
            right: `${rightInsetRem + 0.75}rem`,
            padding: "0.15rem 0.4rem",
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            fontSize: "0.75rem",
            fontFamily: "monospace",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        >
          z{zoom.toFixed(2)}
        </div>
      )}
    </div>
  );
}
