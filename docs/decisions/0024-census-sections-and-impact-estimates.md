# ADR-0024: Census sections and post-scenario impact estimates

Status: accepted (local only; see "Deploying" below for what the cloud
stack still needs)

## Context

Until now a scenario's output stopped at damage: a damage state per
building, and damage-state counts per municipality (ADR-0013/0014). The
next step is what that damage means for people and for the emergency
response. Per affected municipality, show:
- % of buildings affected;
- total population;
- % of population affected;
- % of vulnerable/dependent population affected;
- material cost;
- debris weight;
- truck rotations to clear the debris;
- shoring props ("puntales") needed.

Also add a spatial level between municipality and building: the INE census
section (~36.5k nationwide, typically 1,000–2,500 residents). It's the
smallest unit INE publishes population for, which is what makes the
population figures possible at all.

## Decision

**Data (pipelines/exposure `census_sections.py`, `census_sections_cli`).**
Two INE datasets for the same date, 1 January 2025: section boundaries
(`seccionado_2025.zip`) and the Censo Anual de Población's section-level
population by 5-year age group (one table per province). Sections are
redrawn every year, so the two must be the same edition. Checked: all
36,554 sections match, 49,128,297 residents (DATA-SOURCES.md).

**Building → section is precomputed, once**, for the same reason as
ADR-0014's `municipality_code`: it never changes between requests.
- Each building's centroid is placed in a section of its own municipality,
  or the nearest one of them if none contains it. That way section stats
  always roll up to the same municipality.
- Municipalities merged since the crawl (e.g. Oza dos Ríos + Cesuras →
  Oza-Cesuras) and Catastro's non-INE office codes search their province
  instead. That also re-homes those ~9,000 buildings under their current
  INE municipality.
- Result: 13,013,185 buildings placed, none unassigned.

**Sidecars, not a rewrite of the parts.** Each municipality gets a
`<code>.sites.parquet` next to its `<code>.buildings.parquet`. It holds
exactly the columns the scenario query reads, plus `census_section_code`,
`num_dwellings` and `built_area_m2` (cadastral floor area, or footprint ×
storeys where the Foral sources have none). The durable
`*.buildings.parquet` parts aren't touched.
- The sidecars are compacted into one spatially-sorted
  `buildings-cloud-impact.parquet`, with the same layout and reasoning as
  `buildings-cloud.parquet`.
- `bin/twiner` now defaults to that file when it exists.
- The whole build (sidecars + tables + tiles + compaction) took about 1.5
  minutes nationally.

**Estimates are computed server-side, streamed, from three sums per
section.** `impact.ImpactCounter` replaces `MunicipalityCounter` in
`engine.summarize_scenario`. Per section and damage state, it sums the
buildings, their dwellings and their built area. Every reported figure
derives from those sums plus static section totals (population,
under-15/65-plus, dwellings, buildings) loaded once per process. Memory is
still bounded by the batch size (ADR-0020); the counter holds at most
~36.5k small arrays. The formulas and every parameter are in
[docs/impact-estimates.md](../impact-estimates.md): dwelling-proportional
population, HAZUS-derived repair and debris ratios, round-number
placeholders elsewhere.

**Response shape.**
- `municipality_stats` rows for **damaged** municipalities gain:
  - name and bbox;
  - `n_buildings`, `pct_buildings_affected`;
  - population, vulnerable, affected, displaced;
  - cost, debris, trucks, props.
- Undamaged rows are slimmed to code and counts.
- PO011 "very_low" (3,276 evaluated, 1,129 damaged municipalities) is 924KB
  raw / 142KB gzipped. That's up from 401KB / 31KB before (ADR-0019), and
  well inside the Function URL's 6MB cap.
- Section rows (damaged sections only) are stored per scenario
  (`section_stats.json.gz`), not returned inline. Two new routes serve
  them:
  - `GET /results/{id}/section_stats?municipality_code=`: one
    municipality's rows, for the sidebar drill-down and section popups.
  - `GET /results/{id}/section_severity`: `{section_code: mean damage
    0-4}` for every damaged section, which is all the map needs (PO011
    "very_low": 22KB gzipped).
- `API_VERSION` 5.

**Frontend.**
- A right-hand `ImpactSidebar` opens on every result, titled with the
  scenario ("Alhama de Murcia (1/4) - Mmax. 6.7 - High probability"). It
  lists affected municipalities by damage class, then by % of buildings
  affected, with a search box. Closing it clears the scenario (result
  layers back to their pre-scenario state, viewport unchanged).
- There's no left sidebar: scenarios start from map popups (a fault's in
  Automatic mode, with a name + Mmax hover tooltip; a clicked point's in
  Manual mode). A small overlay holds the mode toggle and run status.
- Clicking one fetches its sections, frames the municipality below
  building zoom, and lists its sections with the same figures.
- Clicking a section in the sidebar outlines it and centers it at z11.5,
  the closest view that still shows sections.
- The map gets a third choropleth level: municipalities below z9, sections
  z9–z12 (`sections.pmtiles`, same severity colors), buildings from z12.
  Buildings used to start at z11; they moved up a level so sections get a
  usable zoom band.
- A selected municipality's sections also show below z9, on their own
  layer, so a large municipality framed at z8 still shows them. Its own
  municipality fill is hidden underneath.

## Alternatives considered

- **Point-in-polygon per request** (sections have no precomputed key):
  rejected for the reason ADR-0014 already measured. It's the dominant cost
  at millions of buildings, for a relationship that never changes.
- **Rewrite `*.buildings.parquet` with the new columns**, as ADR-0014's
  backfill did: works, but rewrites 8,141 durable files other sessions
  read, to add columns only the compacted file needs. Sidecars are
  additive and cheap to regenerate.
- **Population from the building side** (dwellings × a national
  household size): simpler, but ignores real regional differences. INE's
  section counts are the actual numbers; dwellings only decide how they're
  spread inside a section.
- **All section rows inline in the response:** tens of thousands of rows
  for a large fault (PO011 "very_low": 5,105 damaged sections), for
  detail only needed once the user drills into one municipality.
- **A fixed cost/debris per damaged building** (the original rough
  suggestion): cadastral floor area is already on every building, and a
  2-storey house and a 10-storey block differ by far more than 10× in
  cost and rubble.

## Consequences

- Section boundaries and population are tied to a year. Moving to a newer
  edition means:
  1. updating `REFERENCE_YEAR` and `POPULATION_TABLE_IDS` (INE assigns new
     table ids per edition; re-walk the index, don't guess);
  2. deleting the `*.sites.parquet` sidecars;
  3. re-running `census_sections_cli`.
- A dataset without the census files still works: sections come out empty,
  population figures are 0, and cost/debris need `built_area_m2`.
  `engine._impact_columns` fills missing columns with defaults rather than
  failing, the same "additive, not required" stance as ADR-0013.
- The estimates are placeholders (docs/impact-estimates.md). Changing a
  parameter changes results, so bump `API_VERSION`.

### Deploying (not done yet)

The deployed stack still reads `exposure/buildings-cloud.parquet` and has
no census data, so the new routes 404 there. To deploy:
1. Upload `data/exposure/buildings-cloud-impact.parquet` (point
   `TWINER_BUILDINGS_PATH` at it) and `data/census/sections_meta.parquet` +
   `municipalities_meta.parquet` (set `TWINER_CENSUS_DIR` to their S3
   prefix).
2. Upload `sections.pmtiles` next to the other tiles.
3. Bump `DATA_VERSION`.
4. Check `AreaMeta.load` reading `s3://` inside the built image before
   deploying (pyarrow's S3 filesystem, not yet exercised).
