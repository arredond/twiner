import { API_URL } from "./scenarioApi";
import { staticDataUrl } from "./staticData";

// Client for flood scenarios (ADR-0029): services/scenario's
// POST /scenarios/flood, plus the static admin-area index the area picker
// searches. Section rows and the infrastructure list come through the same
// /results/{id}/... routes as a seismic scenario's.

// MITECO's four mapped return periods (years). Canarias only has 100/500.
export const RETURN_PERIODS = [10, 50, 100, 500] as const;
export type ReturnPeriod = (typeof RETURN_PERIODS)[number];

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
  hazard: "flood";
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

export async function runFloodScenario(returnPeriod: ReturnPeriod, region: FloodRegion): Promise<FloodResult> {
  const resp = await fetch(`${API_URL}/scenarios/flood`, {
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

// Case- and accent-insensitive.
export function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Best matches first: names starting with the query, then containing it;
// CCAA before provinces before municipalities on ties.
export function searchAdminAreas(index: AdminArea[], query: string, limit = 12): AdminArea[] {
  const needle = normalizeName(query.trim());
  if (!needle) return [];
  const levelRank: Record<AdminLevel, number> = { ccaa: 0, province: 1, municipality: 2 };
  const scored: Array<[number, AdminArea]> = [];
  for (const area of index) {
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
