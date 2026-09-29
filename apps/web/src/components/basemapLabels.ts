import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Language } from "../i18n";

// Basemap label language. Carto's Positron/Dark Matter styles hardcode
// `{name_en}` for countries, regions, cities and the like (and plain
// `{name}`, the local name, for streets and other detail), but their
// OpenMapTiles-schema tiles carry `name:<lang>` for every language -- so
// each `{name_en}` becomes "this language's name, else the local name".
// Local-name labels are left alone: streets stay as they're signposted.

// Label field as the style has it: a string template or a legacy zoom
// function ({ stops: [[zoom, template], ...] }), which is what Carto uses.
type TextField = NonNullable<Extract<LayerSpecification, { type: "symbol" }>["layout"]>["text-field"];

// A layer's original (English) label field, keyed by layer id -- what
// every language is derived from, since a localized field no longer says
// which parts were `{name_en}`.
export type BasemapLabels = Map<string, TextField>;

const NAME_EN = "{name_en}";

function mentionsNameEn(field: unknown): boolean {
  return JSON.stringify(field ?? null).includes(NAME_EN);
}

// Basemap symbol layers whose label uses the English name.
export function collectBasemapLabels(layers: LayerSpecification[], basemapSourceIds: Set<string>): BasemapLabels {
  const labels: BasemapLabels = new Map();
  for (const layer of layers) {
    if (layer.type !== "symbol" || !basemapSourceIds.has(layer.source)) continue;
    const field = layer.layout?.["text-field"];
    if (field !== undefined && mentionsNameEn(field)) labels.set(layer.id, field as TextField);
  }
  return labels;
}

// One template as an expression: `{name_en}` -> the language's name with a
// local-name fallback, `{name}` -> the local name.
function templateExpr(template: string, lang: Language): ExpressionSpecification | string {
  if (template === NAME_EN) return ["coalesce", ["get", `name:${lang}`], ["get", "name"]];
  if (template === "{name}") return ["get", "name"];
  return template;
}

export function localizedTextField(field: TextField, lang: Language): TextField {
  // The styles' own labels are English already.
  if (lang === "en") return field;
  if (typeof field === "string") return templateExpr(field, lang) as TextField;
  if (field && typeof field === "object" && "stops" in field && Array.isArray(field.stops)) {
    // A string zoom function steps (no interpolation): the value of the
    // last stop at or below the zoom, the first stop's below all of them.
    const stops = field.stops as Array<[number, string]>;
    return [
      "step",
      ["zoom"],
      templateExpr(stops[0][1], lang),
      ...stops.slice(1).flatMap(([zoom, template]) => [zoom, templateExpr(template, lang)]),
    ] as unknown as TextField;
  }
  return field;
}

// Style-level: used on a style about to be applied (theme switch).
export function localizeLayers(layers: LayerSpecification[], labels: BasemapLabels, lang: Language): LayerSpecification[] {
  return layers.map((layer) => {
    const original = labels.get(layer.id);
    if (original === undefined || layer.type !== "symbol") return layer;
    return { ...layer, layout: { ...layer.layout, "text-field": localizedTextField(original, lang) } };
  });
}

// Map-level: on the live map (initial load, language switch).
export function applyBasemapLanguage(map: MapLibreMap, labels: BasemapLabels, lang: Language): void {
  for (const [layerId, original] of labels) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "text-field", localizedTextField(original, lang));
  }
}
