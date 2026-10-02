import { API_URL } from "./scenarioApi";
import { staticDataUrl } from "./staticData";

// Client for flood scenarios: services/scenario's POST /scenarios/flood
// (river flooding, twinFLOOD, ADR-0029) and POST /scenarios/coast (coastal
// flooding, twinCOAST, ADR-0037), plus the static admin-area index the
// area picker searches. Section rows and the infrastructure list come
// through the same /results/{id}/... routes as a seismic scenario's.

// Which flood hazard: the response's `hazard`, and the route's last part.
export type FloodKind = "flood" | "coast";
export const FLOOD_KINDS = ["flood", "coast"] as const;

// MITECO's mapped return periods (years). River: four (Canarias only has
// 100/500). Coast: 100/500 only, everywhere.
export const RETURN_PERIODS = [10, 50, 100, 500] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];
export const KIND_RETURN_PERIODS: Record<FloodKind, readonly ReturnPeriod[]> = {
  flood: RETURN_PERIODS,
  coast: [100, 500],
};

export type AdminLevel = "ccaa" | "province" | "municipality";

export interface FloodCircle {
  type: "circle";
  lat: number;
  lon: number;
  radius_km: number;
}

export interface FloodAdminRegion {
  type: "admin";
  level: AdminLevel;
  code: string;
}

export type FloodRegion = FloodCircle | FloodAdminRegion;

// Figures for one area, over the buildings flooded at the scenario's
// return period (services/scenario/flood.py). Percentages use the area's
// census totals as denominators and are null when that's 0. Population
// is spread over a section's buildings by dwellings, like the seismic
// estimates (docs/impact-estimates.md).
export interface FloodAreaStats {
  name: string | null;
  bbox: [number, number, number, number] | null;
  n_flooded: number;
  n_buildings: number;
  pct_buildings_flooded: number | null;
  flooded_dwellings: number;
  population: number;
  affected_population: number;
  pct_population_affected: number | null;
  vulnerable_population: number;
  affected_vulnerable_population: number;
  pct_vulnerable_affected: number | null;
  // Flood-zone area inside the region (and this area), km2.
  flooded_area_km2: number;
}

export interface FloodMunicipalityStats extends FloodAreaStats {
  municipality_code: string;
}

export interface FloodSectionStats extends FloodAreaStats {
  section_code: string;
  municipality_code: string;
}

export interface FloodTotals {
  n_flooded: number;
  flooded_dwellings: number;
  affected_population: number;
  affected_vulnerable_population: number;
  flooded_area_km2: number;
  n_municipalities: number;
  n_sections: number;
}

export interface FloodResult {
  scenario_id: string;
  hazard: FloodKind;
  flood: {
    return_period: ReturnPeriod;
    region: FloodRegion;
    // Provinces in the region with no map at this return period
    // (Canarias at T=10/T=50): "not mapped", not "not flooded".
    unmapped_provinces: string[];
  };
  // [west, south, east, north] to fit the map to.
  region_bbox: [number, number, number, number] | null;
  n_flooded: number;
  totals: FloodTotals;
  // Every municipality with flooded buildings or flood-zone area in the
  // region (n_flooded can be 0 for the latter).
  municipality_stats: FloodMunicipalityStats[];
  infrastructure_summary: Record<string, number> | null;
  cached?: boolean;
  elapsed_ms?: number;
}

// A critical-infrastructure asset in the flood zone: the seismic row
// without its intensity/damage fields.
export interface FloodInfrastructureRow {
  asset_id: number;
  category: string;
  subtype: string;
  name: string | null;
  municipality_code: string;
  lon: number;
  lat: number;
}

// Circles are sent rounded (see scenarioApi's roundCoord): the centre to
// ~1m, the radius to 10m, so the same drawn circle maps to the same
// content-addressed scenario id.
export function roundRegion(region: FloodRegion): FloodRegion {
  if (region.type !== "circle") return region;
  return {
    type: "circle",
    lat: Number(region.lat.toFixed(5)),
    lon: Number(region.lon.toFixed(5)),
    radius_km: Number(region.radius_km.toFixed(2)),
  };
}

export async function runFloodScenario(
  kind: FloodKind,
  returnPeriod: ReturnPeriod,
  region: FloodRegion
): Promise<FloodResult> {
  const resp = await fetch(`${API_URL}/scenarios/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ return_period: returnPeriod, region: roundRegion(region) }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`flood scenario request failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_URL}${path}`);
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`request failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

export function getFloodSectionStats(scenarioId: string, municipalityCode: string): Promise<FloodSectionStats[]> {
  const query = new URLSearchParams({ municipality_code: municipalityCode });
  return getJson(`/results/${encodeURIComponent(scenarioId)}/section_stats?${query}`);
}

// section_code -> % of its buildings flooded, for the section choropleth.
export function getFloodSectionShares(scenarioId: string): Promise<Record<string, number>> {
  return getJson(`/results/${encodeURIComponent(scenarioId)}/section_severity`);
}

export function getFloodInfrastructure(scenarioId: string): Promise<FloodInfrastructureRow[]> {
  return getJson(`/results/${encodeURIComponent(scenarioId)}/infrastructure`);
}

// --- admin areas (pipelines/exposure admin_areas.py) --------------------

export interface AdminArea {
  level: AdminLevel;
  code: string;
  name: string;
  bbox: [number, number, number, number];
  // The CCAA a province belongs to, or the province a municipality does.
  parent: string | null;
}

interface AdminIndexFile {
  ccaa: [string, string, number, number, number, number][];
  province: [string, string, string, number, number, number, number][];
  municipality: [string, string, number, number, number, number][];
}

let adminIndex: Promise<AdminArea[]> | null = null;

// Every CCAA, province and municipality (~8.2k), fetched once.
export function loadAdminIndex(): Promise<AdminArea[]> {
  adminIndex ??= fetch(staticDataUrl("admin_index.json"))
    .then((resp) => {
      if (!resp.ok) throw new Error(`admin index request failed (${resp.status})`);
      return resp.json() as Promise<AdminIndexFile>;
    })
    .then((file) => [
      ...file.ccaa.map(([code, name, ...bbox]): AdminArea => ({
        level: "ccaa",
        code,
        name,
        bbox: bbox as AdminArea["bbox"],
        parent: null,
      })),
      ...file.province.map(([code, name, parent, ...bbox]): AdminArea => ({
        level: "province",
        code,
        name,
        bbox: bbox as AdminArea["bbox"],
        parent,
      })),
      ...file.municipality.map(([code, name, ...bbox]): AdminArea => ({
        level: "municipality",
        code,
        name,
        bbox: bbox as AdminArea["bbox"],
        parent: code.slice(0, 2),
      })),
    ]);
  adminIndex.catch(() => {
    adminIndex = null; // retry on the next call
  });
  return adminIndex;
}

// --- coverage (pipelines/flood areas.py) ---------------------------------

// The admin areas a hazard's maps reach at all: twinCOAST's picker and
// search list only these (coastal zones touch ~400 of ~8.1k
// municipalities). CCAA come from the provinces' parents in the admin index.
export interface FloodCoverage {
  municipality: Set<string>;
  province: Set<string>;
  ccaa: Set<string>;
}

interface CoverageFile {
  municipality: string[];
  province: string[];
}

const coverage: Partial<Record<FloodKind, Promise<FloodCoverage | null>>> = {};

// null: the hazard lists every area (river flooding).
export function loadCoverage(kind: FloodKind): Promise<FloodCoverage | null> {
  if (kind === "flood") return Promise.resolve(null);
  let pending = coverage[kind];
  if (!pending) {
    pending = Promise.all([
      fetch(staticDataUrl(`${kind}_areas.json`)).then((resp) => {
        if (!resp.ok) throw new Error(`coverage request failed (${resp.status})`);
        return resp.json() as Promise<CoverageFile>;
      }),
      loadAdminIndex(),
    ]).then(([file, index]) => coverageFrom(file, index));
    pending.catch(() => {
      delete coverage[kind]; // retry on the next call
    });
    coverage[kind] = pending;
  }
  return pending;
}

export function coverageFrom(file: CoverageFile, index: AdminArea[]): FloodCoverage {
  const province = new Set(file.province);
  const ccaa = new Set(
    index.filter((a) => a.level === "province" && province.has(a.code) && a.parent).map((a) => a.parent as string)
  );
  return { municipality: new Set(file.municipality), province, ccaa };
}

export function isCovered(area: { level: AdminLevel; code: string }, cov: FloodCoverage | null): boolean {
  return cov === null || cov[area.level].has(area.code);
}

// Case- and accent-insensitive.
export function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Best matches first: names starting with the query, then containing it;
// CCAA before provinces before municipalities on ties.
export function searchAdminAreas(
  index: AdminArea[],
  query: string,
  limit = 12,
  cov: FloodCoverage | null = null
): AdminArea[] {
  const needle = normalizeName(query.trim());
  if (!needle) return [];
  const levelRank: Record<AdminLevel, number> = { ccaa: 0, province: 1, municipality: 2 };
  const scored: Array<[number, AdminArea]> = [];
  for (const area of index) {
    if (!isCovered(area, cov)) continue;
    const name = normalizeName(area.name);
    const at = name.indexOf(needle);
    if (at < 0 && area.code !== needle) continue;
    // Also match any part of a bilingual name ("Valencia/València").
    const wordStart = at === 0 || /[\s/-]/.test(name[at - 1] ?? "");
    scored.push([(at === 0 ? 0 : wordStart ? 1 : 2) * 10 + levelRank[area.level], area]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, area]) => area);
}
