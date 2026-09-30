import type { StyleSpecification } from "maplibre-gl";
import type { TranslationKey } from "./i18n";
import type { Theme } from "./settings";

// Basemaps for the bottom-right picker (components/BasemapPicker.tsx):
// Carto's two vector styles, a handful of IGN/IDEE WMTS raster services,
// and raster tile sources the user pastes in themselves (WMTS or XYZ).
//
// Every WMTS basemap is drawn as a plain XYZ raster source: MapLibre only
// speaks Web Mercator, so we use each service's GoogleMapsCompatible tile
// matrix set, whose TileMatrix ids are the zoom levels themselves -- the
// KVP GetTile URL then takes {z}/{x}/{y} directly.

export interface RasterBasemap {
  kind: "raster";
  id: string;
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  // "tms" for XYZ templates that count rows from the bottom ({-y}).
  scheme: "xyz" | "tms";
  attribution?: string;
}

interface VectorBasemap {
  kind: "vector";
  id: string;
  styleUrl: string;
  // A raster rendition of the same style, for the picker's thumbnail.
  thumbnailTiles: string;
}

// A user-added raster source (the picker's "+"), kept in Settings.
export interface CustomBasemap extends RasterBasemap {
  name: string;
}

export type Basemap = VectorBasemap | RasterBasemap | CustomBasemap;

const IGN_ATTRIBUTION = '© <a href="https://www.scne.es/" target="_blank" rel="noopener">IGN / CNIG</a> (CC BY 4.0)';

// A KVP GetTile template on a service's GoogleMapsCompatible set.
function wmtsTiles(service: string, layer: string, style: string, format: string): string[] {
  const params = new URLSearchParams({
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: layer,
    STYLE: style,
    FORMAT: format,
    TILEMATRIXSET: "GoogleMapsCompatible",
  });
  // URLSearchParams would escape the braces.
  return [`${service}?${params}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`];
}

function ignWmts<Id extends string>(
  id: Id,
  service: string,
  layer: string,
  style: string,
  format: string
): RasterBasemap & { id: Id } {
  return {
    kind: "raster",
    id,
    tiles: wmtsTiles(service, layer, style, format),
    tileSize: 256,
    minzoom: 0,
    maxzoom: 20,
    scheme: "xyz",
    attribution: IGN_ATTRIBUTION,
  };
}

// Layer/style/format per service come from each one's GetCapabilities.
export const BUILTIN_BASEMAPS = [
  {
    kind: "vector",
    id: "positron",
    styleUrl: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    thumbnailTiles: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  },
  {
    kind: "vector",
    id: "dark-matter",
    styleUrl: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    thumbnailTiles: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  },
  ignWmts("pnoa-ma", "https://www.ign.es/wmts/pnoa-ma", "OI.OrthoimageCoverage", "default", "image/jpeg"),
  ignWmts("ign-base", "https://www.ign.es/wmts/ign-base", "IGNBaseTodo", "default", "image/jpeg"),
  ignWmts("ign-lidar", "https://wmts-mapa-lidar.idee.es/lidar", "EL.GridCoverageDSM", "default", "image/png"),
  ignWmts(
    "land-cover",
    "https://servicios.idee.es/wmts/ocupacion-suelo",
    "LC.LandCoverSurfaces",
    "LC.LandCoverSurfaces.Default",
    "image/png"
  ),
  // The service's other layer, EL.ElevationGridCoverage, is the raw
  // elevation as flat greys -- the shaded relief reads far better as a
  // basemap.
  ignWmts("mdt", "https://servicios.idee.es/wmts/mdt", "Relieve", "Default", "image/jpeg"),
] as const satisfies readonly Basemap[];

export type BuiltinBasemapId = (typeof BUILTIN_BASEMAPS)[number]["id"];

// The theme's own Carto style: what the map shows until the user picks
// something else (Settings.basemap === null).
export const THEME_BASEMAP: Record<Theme, BuiltinBasemapId> = { light: "positron", dark: "dark-matter" };

export function isBuiltinBasemapId(id: unknown): id is BuiltinBasemapId {
  return BUILTIN_BASEMAPS.some((b) => b.id === id);
}

export function basemapLabel(basemap: Basemap, t: (key: TranslationKey) => string): string {
  if ("name" in basemap) return basemap.name;
  return t(`basemap.name.${basemap.id as BuiltinBasemapId}`);
}

export function resolveBasemap(id: string | null, custom: CustomBasemap[], theme: Theme): Basemap {
  const themeDefault = BUILTIN_BASEMAPS.find((b) => b.id === THEME_BASEMAP[theme])!;
  if (id === null) return themeDefault;
  return BUILTIN_BASEMAPS.find((b) => b.id === id) ?? custom.find((b) => b.id === id) ?? themeDefault;
}

// Shared with Carto's styles so a switch doesn't reload the glyphs the
// overlays' own labels use (AEMET station values).
const GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

export function rasterSourceId(basemap: RasterBasemap): string {
  return `basemap-${basemap.id}`;
}

// A raster basemap as a whole style (map.setStyle takes a style, and
// DamageMap's keepOverlays lays the overlays on top of it).
export function rasterStyle(basemap: RasterBasemap, theme: Theme): StyleSpecification {
  const source = rasterSourceId(basemap);
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      [source]: {
        type: "raster",
        tiles: basemap.tiles,
        tileSize: basemap.tileSize,
        minzoom: basemap.minzoom,
        maxzoom: basemap.maxzoom,
        scheme: basemap.scheme,
        ...(basemap.attribution ? { attribution: basemap.attribution } : {}),
      },
    },
    layers: [
      // Beyond a service's coverage (the sea, outside Spain).
      { id: "basemap-background", type: "background", paint: { "background-color": theme === "dark" ? "#1c1d21" : "#e8e8e8" } },
      { id: `${source}-raster`, type: "raster", source },
    ],
  };
}

// --- Thumbnails ------------------------------------------------------------

export interface View {
  lng: number;
  lat: number;
  zoom: number;
}

// One tile of `basemap` around the view's centre, a couple of levels out so
// the miniature shows the surroundings rather than a blur of the middle.
export function thumbnailUrl(basemap: Basemap, view: View): string {
  const template = basemap.kind === "vector" ? basemap.thumbnailTiles : basemap.tiles[0];
  const minzoom = basemap.kind === "vector" ? 0 : basemap.minzoom;
  const maxzoom = basemap.kind === "vector" ? 18 : basemap.maxzoom;
  const z = Math.max(minzoom, Math.min(maxzoom, Math.floor(view.zoom) - 1));
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((view.lng + 180) / 360) * n)));
  const latRad = (Math.max(-85, Math.min(85, view.lat)) * Math.PI) / 180;
  const yXyz = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n)));
  const y = basemap.kind === "raster" && basemap.scheme === "tms" ? n - 1 - yXyz : yXyz;
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

// --- User-added sources ----------------------------------------------------

// What a pasted URL turned out to be: a ready tile template, or a WMTS
// service whose capabilities list layers to pick from.
export type ParsedSource =
  | { kind: "template"; basemap: Omit<RasterBasemap, "id" | "kind"> }
  | { kind: "wmts"; capabilitiesUrl: string };

const XYZ_DEFAULTS = { tileSize: 256, minzoom: 0, maxzoom: 22, scheme: "xyz" as const };

// Case-insensitive `{name}` placeholder replacement.
function replacePlaceholder(template: string, name: string, value: string): string {
  return template.replace(new RegExp(`\\{${name}\\}`, "gi"), value);
}

export function parseSourceUrl(input: string): ParsedSource {
  const url = input.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("basemap.custom.errorUrl");

  // XYZ ({z}/{x}/{y}, or TMS-style {-y}).
  if (/\{z\}/i.test(url) && /\{x\}/i.test(url) && /\{-?y\}/i.test(url)) {
    const tms = /\{-y\}/i.test(url);
    const tiles = replacePlaceholder(replacePlaceholder(replacePlaceholder(url, "-y", "{y}"), "z", "{z}"), "x", "{x}");
    return {
      kind: "template",
      basemap: { ...XYZ_DEFAULTS, tiles: [replacePlaceholder(tiles, "y", "{y}")], scheme: tms ? "tms" : "xyz" },
    };
  }

  // A WMTS RESTful template (as in a capabilities ResourceURL). Assumes a
  // Web Mercator set whose TileMatrix ids are the zoom levels.
  if (/\{TileMatrix\}/i.test(url)) {
    let tiles = replacePlaceholder(url, "TileMatrixSet", "GoogleMapsCompatible");
    tiles = replacePlaceholder(tiles, "TileMatrix", "{z}");
    tiles = replacePlaceholder(tiles, "TileRow", "{y}");
    tiles = replacePlaceholder(tiles, "TileCol", "{x}");
    tiles = replacePlaceholder(tiles, "Style", "default");
    return { kind: "template", basemap: { ...XYZ_DEFAULTS, tiles: [tiles] } };
  }

  const parsed = new URL(url);
  const params = new Map([...parsed.searchParams].map(([k, v]) => [k.toUpperCase(), { key: k, value: v }]));

  // A single KVP GetTile request: turn its tile coordinates into placeholders.
  if (params.get("REQUEST")?.value.toUpperCase() === "GETTILE") {
    for (const [name, placeholder] of [["TILEMATRIX", "{z}"], ["TILEROW", "{y}"], ["TILECOL", "{x}"]] as const) {
      const param = params.get(name);
      if (!param) throw new Error("basemap.custom.errorGetTile");
      parsed.searchParams.set(param.key, placeholder);
    }
    const tiles = parsed.toString().replace(/%7B/gi, "{").replace(/%7D/gi, "}");
    return { kind: "template", basemap: { ...XYZ_DEFAULTS, tiles: [tiles] } };
  }

  // Anything else: a WMTS service endpoint or its capabilities document.
  if (!params.has("REQUEST") && !/\.xml$/i.test(parsed.pathname)) {
    parsed.searchParams.set("SERVICE", "WMTS");
    parsed.searchParams.set("REQUEST", "GetCapabilities");
  }
  return { kind: "wmts", capabilitiesUrl: parsed.toString() };
}

export interface WmtsLayerOption {
  id: string;
  title: string;
  basemap: Omit<RasterBasemap, "id" | "kind">;
}

// Scale denominator of Web Mercator zoom 0 at 256px tiles (the OGC
// GoogleMapsCompatible well-known scale set).
const Z0_SCALE = 559082264.0287178;

function kids(el: Element | Document, name: string): Element[] {
  const parent = el instanceof Document ? el.documentElement : el;
  return Array.from(parent.children).filter((c) => c.localName === name);
}
function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0];
}
function text(el: Element | undefined, name: string): string | undefined {
  return el ? kid(el, name)?.textContent?.trim() || undefined : undefined;
}

interface MercatorSet {
  // TileMatrix id = prefix + zoom (usually "", sometimes "EPSG:3857:").
  prefix: string;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
}

// A tile matrix set MapLibre can draw directly: Web Mercator, one matrix
// per zoom with the standard scales, and ids that end in the zoom level.
function mercatorSet(set: Element): MercatorSet | null {
  const crs = text(set, "SupportedCRS") ?? "";
  if (!/(3857|900913|102100)$/.test(crs)) return null;
  let prefix: string | null = null;
  let tileSize: number | null = null;
  const zooms: number[] = [];
  for (const matrix of kids(set, "TileMatrix")) {
    const id = text(matrix, "Identifier") ?? "";
    const width = Number(text(matrix, "MatrixWidth"));
    const size = Number(text(matrix, "TileWidth"));
    const scale = Number(text(matrix, "ScaleDenominator"));
    const z = Math.log2(width);
    if (!Number.isInteger(z) || !id.endsWith(String(z))) return null;
    if (Math.abs(scale / ((Z0_SCALE * 256) / size / 2 ** z) - 1) > 0.01) return null;
    const matrixPrefix = id.slice(0, id.length - String(z).length);
    if ((prefix !== null && matrixPrefix !== prefix) || (tileSize !== null && size !== tileSize)) return null;
    prefix = matrixPrefix;
    tileSize = size;
    zooms.push(z);
  }
  if (prefix === null || tileSize === null) return null;
  return { prefix, tileSize, minzoom: Math.min(...zooms), maxzoom: Math.max(...zooms) };
}

// The layers of a WMTS capabilities document that have a Web Mercator
// tile matrix set, as ready-to-use raster sources.
export function parseWmtsCapabilities(xml: string, capabilitiesUrl: string): WmtsLayerOption[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("basemap.custom.errorCapabilities");
  const root = doc.documentElement;
  const contents = kid(root, "Contents");
  if (!contents) throw new Error("basemap.custom.errorCapabilities");

  const sets = new Map<string, MercatorSet>();
  for (const set of kids(contents, "TileMatrixSet")) {
    const id = text(set, "Identifier");
    const mercator = mercatorSet(set);
    if (id && mercator) sets.set(id, mercator);
  }

  // KVP endpoint: the capabilities' own GetTile href, else the URL we
  // fetched them from.
  let kvpBase = capabilitiesUrl.split("?")[0];
  for (const op of root.getElementsByTagNameNS("*", "Operation")) {
    if (op.getAttribute("name") !== "GetTile") continue;
    const href = op.getElementsByTagNameNS("*", "Get")[0]?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (href) kvpBase = href.split("?")[0];
  }
  const provider = root.getElementsByTagNameNS("*", "ProviderName")[0]?.textContent?.trim();

  const options: WmtsLayerOption[] = [];
  for (const layer of kids(contents, "Layer")) {
    const id = text(layer, "Identifier");
    if (!id) continue;
    const setId = kids(layer, "TileMatrixSetLink")
      .map((link) => text(link, "TileMatrixSet"))
      .find((s): s is string => s !== undefined && sets.has(s));
    if (!setId) continue;
    const set = sets.get(setId)!;
    const styles = kids(layer, "Style");
    const style =
      text(styles.find((s) => s.getAttribute("isDefault") === "true") ?? styles[0], "Identifier") ?? "default";
    const formats = kids(layer, "Format").map((f) => f.textContent?.trim() ?? "");
    const format = formats.find((f) => f === "image/jpeg") ?? formats.find((f) => f === "image/png") ?? formats[0];
    const rest = kids(layer, "ResourceURL").find((r) => r.getAttribute("resourceType") === "tile");

    let tiles: string;
    if (rest?.getAttribute("template")) {
      tiles = rest.getAttribute("template")!;
      tiles = replacePlaceholder(tiles, "TileMatrixSet", setId);
      tiles = replacePlaceholder(tiles, "TileMatrix", `${set.prefix}{z}`);
      tiles = replacePlaceholder(tiles, "TileRow", "{y}");
      tiles = replacePlaceholder(tiles, "TileCol", "{x}");
      tiles = replacePlaceholder(tiles, "Style", style);
    } else {
      if (!format) continue;
      const params = new URLSearchParams({
        SERVICE: "WMTS",
        REQUEST: "GetTile",
        VERSION: "1.0.0",
        LAYER: id,
        STYLE: style,
        FORMAT: format,
        TILEMATRIXSET: setId,
      });
      tiles = `${kvpBase}?${params}&TILEMATRIX=${encodeURIComponent(set.prefix)}{z}&TILEROW={y}&TILECOL={x}`;
    }
    options.push({
      id,
      title: text(layer, "Title") ?? id,
      basemap: {
        tiles: [tiles],
        tileSize: set.tileSize,
        minzoom: set.minzoom,
        maxzoom: set.maxzoom,
        scheme: "xyz",
        ...(provider ? { attribution: `© ${provider}` } : {}),
      },
    });
  }
  return options;
}

// Settings validation: a stored custom basemap still has the shape we need.
export function isCustomBasemap(value: unknown): value is CustomBasemap {
  const b = value as Partial<CustomBasemap> | null;
  return (
    typeof b === "object" &&
    b !== null &&
    b.kind === "raster" &&
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    Array.isArray(b.tiles) &&
    b.tiles.every((t) => typeof t === "string") &&
    typeof b.tileSize === "number" &&
    typeof b.minzoom === "number" &&
    typeof b.maxzoom === "number" &&
    (b.scheme === "xyz" || b.scheme === "tms")
  );
}
