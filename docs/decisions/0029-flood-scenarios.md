# ADR-0029: Flood scenarios from MITECO's flood zones

Status: accepted. Deploying needs the flood data uploaded to S3 by hand
(docs/deploy-aws-setup.md).

## Context

The app models one hazard, earthquakes. The next is fluvial flooding. MITECO
(the Spanish environment ministry) already delineates flood zones for four
return periods (T=10, 50, 100 and 500 years) in its National Flood Zone
Mapping System (SNCZI). The goal: pick a return period and an area (a drawn
circle, or a CCAA / province / municipality), and see the flooded zones,
the buildings in them, and a per-municipality / per-census-section summary,
like a seismic scenario.

Unlike an earthquake, nothing here depends on the request beyond the return
period and the area. Which buildings lie in which zone is fixed, so it can be
computed once, offline.

## Decision

### Data: manual download, then a normal pipeline (`pipelines/flood`)

Every MITECO flood-zone file is served behind an ALTCHA proof-of-work
captcha (`DescargaFichero?f=<name>` answers with the captcha page, not the
zip). We don't script around it. All the other routes were checked on
2026-09-30 and none serve the vector files (`DATA-SOURCES.md` lists each):
the catalogue's Atom feeds link back to the HTML page, the INSPIRE Atom
service is empty, the OGC API Features endpoint has no flood collections,
the WMS is raster-only, and CNIG blocks scripts. So, as with the BTN
infrastructure data (ADR-0025), the six zips are a manual download into
`data/flood/raw/`, and `sources.py` checks they're there (and are real zips,
not a saved captcha page), listing the URL of any missing one. If MITECO
(or UPM) ever gives us a direct link, only `sources.py` changes.

Files: Península + Baleares for all four return periods (EPSG:25830);
Canarias only for T=100 and T=500 (EPSG:4083). There is no Canarias
T=10/T=50 map, so Canarias buildings get **NULL**, not False, at those
return periods. "Not mapped" and "not flooded" are different answers.

### Zones: repaired, simplified, cut by census section

The zones are traced from a 2m LiDAR terrain model: T=10 alone is 94M
vertices, and 13% of its polygons are invalid. Each polygon is repaired
(`make_valid`), simplified with 1m Douglas-Peucker (half the terrain grid,
far below the maps' 1:25,000 scale; keeps ~15% of the vertices), repaired
again, reprojected to EPSG:4326 and repaired once more (reprojection can
nudge a valid polygon into a tiny self-intersection).

They're then **cut by INE census section** and merged per (section, return
period). The user asked whether to split by section or by municipality.
Sections win:

- A section nests in exactly one municipality (its code's first 5 digits),
  and its province is the first 2. So one split gives exact filters and
  flooded areas at every level: section, municipality, province and CCAA
  (a CCAA is a list of provinces).
- Pieces are smaller, so a footprint intersection test against them is
  cheaper.
- Merging per section removes overlaps between studies of the same stretch
  of river, which would otherwise double-count area and darken the
  translucent fill.

The cost is more features in the zone tiles: pieces cut along section
edges. `--detect-shared-borders` keeps those shared edges simplified
identically, so they don't open slivers.

Output: `zones.parquet` (with geometry, in 500-row groups sorted by section
code; see "Memory" below) and `zone_areas.parquet` (without geometry, for
the scenario service).

### Buildings: footprint intersects the zone

A building counts as in the zone at T when its **footprint** (from the
exposure parts) intersects T's zone, not just its centroid: a long building
on a river bank can have its centroid on dry ground and a wall in the water.
Since it's precomputed, the cost doesn't matter at request time.

`building_flood.parquet` lists only the buildings in a zone at some return
period, with one nullable boolean per return period, plus the columns the
scenario service needs from `buildings-cloud-impact.parquet` (centroid,
municipality, census section, dwellings, built area). A building not in the
file is in no mapped zone. Critical infrastructure (ADR-0025) gets the same
test on each asset's own geometry: `infrastructure_flood.parquet`.

### Tiles: static archives filtered in the browser (an experiment)

- `flood_zones.pmtiles` (`rp`, `sec`): the frontend filters by return
  period, and by section-code prefix for an admin area or by MapLibre's
  `distance` expression for a circle.
- `flood_buildings.pmtiles` (`building_id`, `sec`, `t10`..`t500`): the
  buildings in a zone, filtered the same way.
- `admin_areas.pmtiles` + `admin_index.json` (`exposure.admin_areas`):
  province and CCAA outlines dissolved from the IGN municipalities, and a
  compact search index of every CCAA, province and municipality.

This is deliberately **not** the per-scenario tile join seismic scenarios
use (ADR-0017). A flood scenario has no per-request per-building result:
the flags are static, so the browser can filter a static archive with no
Lambda in the tile path. The risk is sending too much over the wire for
large areas at building zoom. If that happens, the fallback is the existing
tile-join route: store the selected building ids as a scenario result and
join them onto `buildings.pmtiles` exactly like damage states.

### Backend: `POST /scenarios/flood` (`scenario/flood.py`)

Request: `{return_period, region: {type: "circle", lat, lon, radius_km} |
{type: "admin", level: "ccaa"|"province"|"municipality", code}}`.

`building_flood.parquet` is loaded **into memory once per process** and each
request filters it with numpy:
- a circle: bounding-box prefilter, then exact great-circle distance;
- an admin area: code prefix.

Even a 200km circle never touches the 13M-building exposure file, so big
circles cost milliseconds.

Figures per section, rolled up to municipalities, use each section's static
census totals as denominators (same data as ADR-0024):
- buildings, dwellings and residents in the zone, with residents spread over
  a section's buildings by dwellings;
- vulnerable residents in the zone;
- flooded km². A circle's edge cuts some sections' zone pieces; only those
  pieces are intersected with the circle (from `zones.parquet`). The rest
  use the precomputed area.

Seismic cost/debris/shoring figures don't apply: they're earthquake damage
ratios. Results are stored like a seismic scenario's (content-addressed id,
`mode: "flood"`), so the section drill-down, section choropleth
(`section_severity` answers % of buildings in the zone for flood rows) and
infrastructure list reuse the existing `/results/{id}/...` routes, locally
and in the Lambda.

### Frontend

Two hazard cards in the top-left corner, twinQUAKE and twinFLOOD. Both start
collapsed and no hazard is active. Clicking a card's name opens that hazard
and closes the other; once a result shows, clicking the name again starts a
new run. Flood mode has:
- a return period selector (T10/T50/T100/T500);
- an area picker: Circle (default: click the centre, click again for the
  radius, Esc cancels) or CCAA / Province / Municipality. Those draw that
  level's outlines on the map; clicking one runs the scenario and clears the
  outlines;
- a search box across all three levels (picking a result runs it);
- buildings in the zone from z9 (seismic buildings start at z12). The
  buildings toggle also hides the plain grey buildings;
- a legend with separate toggles for zones, buildings and "Zonas afectadas"
  (the municipality/section choropleth, also in seismic mode);
- area-picker hover by feature-state, not `setFilter`: re-filtering the
  ~8k-municipality layer on every mouse move made the outline lag behind
  the cursor;
- one colour per layer kind: blue flood zones, orange buildings in them, a
  purple ramp for the affected areas (the seismic damage colours and fault
  purple stay distinct). The cards' QUAKE / FLOOD names are coloured too;
- critical infrastructure switched on with every run (either hazard) and
  off on clear;
- `FloodSidebar` shows the totals, a "not mapped" note (Canarias at
  T10/T50), the coverage caveat (only studied rivers are mapped), and the
  municipality → section drill-down, sorted like the seismic one by % of
  buildings affected, then count. Choropleths colour by % of buildings in
  the zone.

## Memory and speed (lessons from the first runs)

The first building-flag run took the whole 16GB (swapless) machine down.
`zones.parquet` had been written as one row group, so each of 8 workers
decoded the entire ~0.9GB geometry column just to filter it to its
province. It's now written in 500-row groups sorted by section code, so
the bounding-box filter skips whole row groups (a province loads in ~0.1s),
and the flag step runs 4 workers.

The intersection runs **zone pieces as the query input against a tree of
footprints**, not the other way round. GEOS prepares each query geometry
once, so each big zone polygon is prepared once and tested cheaply against
the small footprints near it. The first way round (footprints querying a
tree of zones) re-evaluated big polygons unprepared for every footprint.
Murcia, with huge rural sections on the Segura plain, ran 17+ minutes that
way, and 16 seconds after the swap.

## Results (national run, 2026-10-01)

| Return period | Sections with a zone | Municipalities | Zone area (km²) | Buildings in zone |
|---|---|---|---|---|
| T=10 | 9,505 | 3,838 | 5,105.6 | 160,113 (+2,561 Canarias NULL) |
| T=50 | 5,438 | 2,408 | 3,827.9 | 158,372 |
| T=100 | 11,005 | 4,026 | 8,686.5 | 417,151 |
| T=500 | 12,130 | 4,041 | 10,674.3 | 657,697 |

- `building_flood.parquet`: 662,130 buildings in a zone at some return
  period, ~5% of the 13.0M. 13MB.
- T=10 has more buildings than T=50 because the T=50 map covers fewer
  rivers (22% of main rivers vs 27%, per the download page). 613 buildings
  are in a T=10 zone but no T=500 one: studies aren't nested.
- Zone area outside every census section (sea, border): 33-44 km² per
  return period, dropped.
- Building flags: 39 seconds for all of Spain with 4 workers.
- Tiles: `flood_zones.pmtiles` 200MB (z7-13, built in ~10 minutes),
  `flood_buildings.pmtiles` (z9-14). Zone
  tiles at z10-13 have a median of 4-12KB and a 95th percentile of
  27-105KB; z7-9 a median of 30-94KB. The worst tile is ~950KB, in a dense
  floodplain. The buildings median is 0.5-1.2KB. The browser only fetches
  what's in view, so the static, filter-in-the-browser path doesn't need
  the tile-join fallback so far.
- **No feature dropping in the zone tiles.** The first build used
  tippecanoe's `--drop-smallest-as-needed` (and before that
  `--coalesce-densest-as-needed`). Both pick **one threshold per zoom
  level**, so a few dense floodplain tiles made tippecanoe drop zone
  pieces, km²-sized ones included, from every tile at that zoom. Zones
  then came and went between zooms, and buildings flagged as in a zone
  showed outside any drawn zone. Around Massamagrell, only 1-7 of the 29
  T=500 pieces survived at z9-13. With `--no-tile-size-limit
  --no-feature-limit` all 29 are there at z9-13; at z7-8 two sub-pixel
  pieces are merged away. Coalescing also sent tippecanoe's polygon
  cleaning into an hour-long spin; without size limits the national build
  takes 10 minutes instead of 39. Zones start at z7: below that the map
  shows the municipality choropleth. (ADR-0037 later added a z0-6
  overview band, for the Spain-wide view an open flood card shows before
  a run.)
- Infrastructure in a zone (T=100): 21,743 assets, 19,861 of them bridges
  (a bridge crosses its river by definition), then 898 schools, 675 power
  assets, 156 dams, 97 health centres, 50 emergency services and 6 care
  homes.
- Request times on the full data (local, warm process; loading the data
  takes 0.19s and 0.46GB once per process):

  | Area | Return period | Time | Buildings in zone |
  |---|---|---|---|
  | 200km circle, Madrid | T=500 | 351ms | 72,847 |
  | 150km circle, Murcia | T=500 | 302ms | 141,803 |
  | Comunitat Valenciana | T=500 | 75ms | 102,258 |
  | Andalucía | T=100 | 70ms | 67,411 |
  | Paiporta | T=100 | 28ms | 108 |

## Alternatives considered

- **Scraping past the captcha**: no.
- **WMS/WFS**: WMS only (rasters, no attributes, no intersection). In any
  case the files are multi-GB, and per-feature services would be
  impractically slow nationally.
- **Split zones by municipality**: fewer, larger pieces. It can't answer
  section-level area or filters, which the section drill-down needs.
- **Centroid-in-zone**: cheaper, but misses buildings whose walls touch the
  water. Since it's offline, the exact test costs nothing at request time.
- **Tile-join for flooded buildings from the start**: kept as the fallback
  (above).
- **"Banded" zones** (each area tagged with the smallest return period
  flooding it): fewer duplicated polygons in the tiles. But zones from
  different studies aren't strictly nested (a T=10 zone isn't always inside
  the T=100 one), so a band would misreport those spots.

## Consequences

- Flood zones cover only studied river stretches (the download page quotes
  27-36% of main rivers). The UI says so: no zone doesn't mean no risk.
- No depth, so no loss estimate. MITECO/CNIG depth rasters (fluvial MPIF2
  T=10/100/500; coastal) plus depth-damage curves would be the next step,
  and ADR-0030 suggests handling depth for both hazards together.
- The zone step (not the tiling) is a one-off ~30 minutes nationally (T=10 427s, T=50 40s,
  T=100 630s, T=500 680s with 8 workers), mostly `make_valid` on
  a few pathological polygons (one T=10 polygon of 1M vertices takes
  ~2.5 minutes). Simplifying before repairing is 30x faster, but it changes
  how ambiguous self-overlaps resolve (1.3% area on that polygon), so the
  repair runs on the raw geometry.
- Coastal flooding: ADR-0030.
