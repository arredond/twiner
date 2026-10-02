# ADR-0037: Coastal flood scenarios (twinCOAST)

Status: accepted. Deploying needs the coastal data uploaded to S3 by hand
(docs/deploy-aws-setup.md) and a `cdk deploy` (new `TWINER_COAST_DIR`).
Supersedes ADR-0030's "nothing built now".

## Context

ADR-0029 added river flood scenarios (twinFLOOD) from MITECO's SNCZI flood
zones. The same system maps **coastal** flooding ("zonas inundables de
origen marino"): how far the sea reaches in a storm at a return period.
ADR-0030 recorded what exists and how it would fit. This ADR builds it as a
third hazard, twinCOAST.

The difference that matters: coastal zones reach a small part of Spain. An
area picker listing Madrid or Teruel is no use, so the picker and search
box only list areas with a coastal zone.

## Data (checked 2026-10-02)

`laminas-q100.zip` and `laminas-q500.zip`, from the
[zi-origen-marino page](https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/costas-medio-marino/zi-origen-marino.html).
Opened and checked, not just named:

- **They are coastal.** `TIPO_ZONA` is "Z.I. PROBABILIDAD MEDIA (100 AÑOS)"
  / "BAJA (500 AÑOS)", and every `ESTUDIO` is "...MAPAS DE PELIGROSIDAD Y
  RIESGO DE INUNDACIÓN DEL LITORAL...". ADR-0030 warned the name pattern
  matches the fluvial T=50 file (`laminas-q50.zip`); these aren't fluvial.
- **Only T=100 and T=500.** 397 polygons each, one per ARPSI stretch of
  coast (`ZONA`, e.g. "Bahía de Algeciras (1-a)"), from the 2014 studies
  (`FECHA` 2014-03-22; iOLE / IH2VOF wave run-up on a 5m terrain model).
- **All of Spain in one file**: Península, Baleares, Canarias, Ceuta and
  Melilla, despite the dataset feeds' "Península Ibérica e Islas Baleares"
  label. So, unlike fluvial, nothing is ever "not mapped".
- **ETRS89 geographic (EPSG:4258)**, not UTM like the fluvial files.
- ~1M vertices per file (1% of fluvial T=10), 10-13% invalid polygons.

### Download: still manual

Same captcha as fluvial: `gis.miteco.gob.es/descargas/app/DescargaFichero?f=laminas-q100.zip`
serves the ALTCHA page. Every other route checked on 2026-10-02:

- The two dataset Atom feeds (`.../dataset/b42355e9-...atom`, `8c13dce4-...`)
  link to the legacy `mapama.gob.es/app/descargas/descargafichero.aspx?f=...`,
  which answers 404.
- The Costas INSPIRE Atom service
  (`mapama.gob.es/ide/inspire/atom/CategCostas/downloadservice.xml`, the
  catalogue's "Servicio de descargas Inspire con ATOM Categoría Costas y
  Medio Marino") answers 500; the general one has no entries.
- MITECO's OGC API Features (`wmts.mapama.gob.es/sig-api/ogc/features/v1`,
  30 collections) and IGN's `api-features.idee.es` (38) have no flood
  collections.
- WMS `wms.mapama.gob.es/sig/Costas/ZI_LaminasQ100|Q500`: raster only.

So the zips are a manual download into `data/coast/raw/`, like ADR-0029's.
`sources.py` checks they're there and real zips.

**A lead for later: IDEE API-Coverages.** The depth datasets' feeds
("Peligrosidad por inundación costera" T=100/T=500) point to
`api-coverages.idee.es/collections/NZ.HazardAreaCoastalFloodT{100,500}_25830`
(50m grid; fluvial `NZ.HazardAreaRiversFloodT{10,100,500}_25830` at 25m).
It needs no captcha: `.../coverage?subset=x(a:b),y(c:d)&f=GTiff` returned
cloud-optimized GeoTIFFs in EPSG:25830 for two 2-4km test boxes (bbox
queries answer 500). Python's default CA store rejects its certificate
chain; `certifi`'s accepts it. Both test boxes came back all zeros, so it's
not yet checked that the depths line up with the vector zones. Depth >
0 could replace the manual vector download, and depth itself is what
depth-damage curves need (ADR-0029 "Consequences", ADR-0030 "What would be
new"). Not done here.

## Decision

### Pipeline: `pipelines/flood --hazard coastal`

The fluvial pipeline was already "polygon zone per return period ->
flagged buildings" (ADR-0030). It now takes a `Hazard` (`sources.py`):
its files, its return periods, the shapefile field naming each zone
(`RIO` / `ZONA`), and the prefix of its tiles (`flood_` / `coast_`).
Nothing else forks:

- **Geographic sources are cleaned in metres.** The 1m Douglas-Peucker
  tolerance is in the source CRS's units, so an EPSG:4258 file is first
  reprojected to EPSG:3035 (LAEA Europe, equal-area, Canarias included),
  then repaired, simplified and reprojected to 4326 as before.
- **Same outputs, own directory**: `data/coast/{zones,zone_areas,
  building_flood,infrastructure_flood}.parquet`. Flag columns keep the
  `flood_t<rp>` names (only `flood_t100`, `flood_t500`), so the scenario
  service reads either hazard's files the same way. `zones.parquet`'s name
  column is `stretches` instead of `rivers`.
- **Tiles**: `coast_zones.pmtiles` / `coast_buildings.pmtiles`, layers
  `coast_zones` / `coast_buildings`, same tippecanoe settings (no feature
  dropping, ADR-0029).
- **Coverage index** (`areas.py`): `coast_areas.json`,
  `{"municipality": [...], "province": [...]}`. Written for either hazard;
  only twinCOAST reads it.

The coverage comes from the pipeline's own output, not a list of coastal
provinces. A municipality counts when a zone covers at least 1,000 m² of it
at some return period, or any of its buildings is flagged. The threshold
drops 3 municipalities where a zone only grazes a census-section edge
(the zones touch 386; 383 are listed). Sevilla is in it (Guadalquivir
estuary); inland provinces aren't. CCAA aren't stored: the frontend takes
each listed province's CCAA from `admin_index.json`.

### Backend: `POST /scenarios/coast`

`scenario/flood.py` takes a `FloodHazard`: `FLUVIAL` (`/scenarios/flood`,
T10/50/100/500, `TWINER_FLOOD_DIR`, Canarias unmapped at T10/T50) and
`COASTAL` (`/scenarios/coast`, T100/500, `TWINER_COAST_DIR`, nothing
unmapped). Same request, same response shape (`hazard: "coast"`, the
parameters still under `flood`), same `/results/{id}/...` routes. Each
hazard's data loads into memory once per process, on first use.

Scenario ids hash the hazard as `mode` ("flood" / "coast"), so the same
region and period never collide across hazards. Fluvial ids hash exactly
what they did before. No `API_VERSION` / `DATA_VERSION` bump: no existing
result or response changes, and the coastal data is new, not re-uploaded.

An admin area with no coastal zone isn't rejected, it just returns no
buildings. The frontend never offers one; an API caller gets an empty,
correct answer.

### Frontend: a third card

twinCOAST (teal) under twinQUAKE and twinFLOOD. It reuses the flood UI
(`FloodPanel`, `FloodLegend`, `FloodSidebar`, `floodLayers`) with a `kind`
(`"flood" | "coast"`):

- return periods T100/T500 only. Switching from twinFLOOD at T10/T50 moves
  to T100;
- the area picker's outlines and the search box are filtered by the
  coverage index (`setAdminPicker`'s filter, `searchAdminAreas`'s
  `coverage`). Search waits until the index loads. The circle tool is
  unchanged: a circle inland just finds nothing;
- separate zone and building layers per kind, the inactive kind's filtered
  out, so the two sets of archives never mix;
- teal zones instead of river blue; the same orange buildings and purple
  affected-area ramp;
- the sidebar's coverage note and source line are coastal-specific.

### Zones before a run, for both flood cards

Opening twinFLOOD or twinCOAST used to show an empty map until a run. Now
the open card shows its zones at the selected return period, all over
Spain (`setFloodPreview`), and switches the zones toggle on. The zone
archives used to start at z7, the map opens at z5.3 and has no minimum
zoom, so they gain a z0-6 **overview band** (a first z4-6 version vanished
when zooming out past z4): built with the same tippecanoe settings (no
feature dropping) and joined to the unchanged z7-13 tiles with `tile-join`
(`tiles.add_zone_overview`, which also retrofits an archive that has only
the detail zooms; `tile-join -Z7` extracts those from one that already has
an overview). Coastal: 28 overview tiles, 0.15MB more, none over 5KB.
Fluvial: 28 tiles, 3.1MB more (200 -> 203MB, built in about a minute); the
largest is 660KB (z6, Valencia/Murcia), under the ~950KB worst detail tile
ADR-0029 measured, and z0-3 are all under 190KB. The z7-13 tiles are the
same 15,851 as before.

## Results (national run, 2026-10-02)

| Return period | Sections with a zone | Municipalities | Zone area in sections (km²) | Buildings in zone |
|---|---|---|---|---|
| T=100 | 1,544 | 385 | 2,025.2 | 43,288 |
| T=500 | 1,571 | 386 | 2,080.1 | 48,949 |

- 185 km² per return period lies outside every census section (sea) and
  is dropped by the section cut.
- `building_flood.parquet`: 48,950 buildings. Only one is in the T=100
  zone but not the T=500 one: the coastal studies are nested, unlike the
  fluvial ones.
- Most buildings in a zone (T=500): Las Palmas 6,724, Sevilla 3,688,
  Santa Cruz de Tenerife 3,331, Cádiz 3,115, Málaga 3,093.
- Infrastructure in a zone (T=500): 1,690 assets, 1,537 of them bridges,
  then 105 schools, 32 power assets, 11 health centres, 4 emergency
  services and 1 dam.
- Run time: zones 256s (4 workers), building flags 11s, infrastructure 1s,
  tiles 214s + 7s. `coast_zones.pmtiles` 8MB, `coast_buildings.pmtiles`
  7MB.

## Alternatives considered

- **A coastal/fluvial/both toggle inside twinFLOOD** (ADR-0030's other
  option). The two have different return periods, coverage and caveats.
  A separate card keeps each panel simple, and combining them later is
  still possible: same data layout, same endpoint code.
- **Columns in the fluvial files** (`coastal_t100` in
  `building_flood.parquet`). Couples two pipelines' reruns; separate
  directories keep each one rebuildable alone.
- **A hand-made list of coastal provinces/municipalities**: misses estuaries
  and lists coast with no studied stretch.
- **Rejecting uncovered admin areas with a 400**: the empty answer is
  correct, and the UI never asks.

## Consequences

- Same caveats as ADR-0029, plus: only studied stretches of coast (ARPSIs)
  are mapped, from 2014 studies, with no sea-level-rise scenarios.
- Extent, not depth: still no loss estimate. The IDEE coverages above are
  the most promising route to depth for both hazards.
- The pipeline's hazard abstraction is ready for a "both" view (EU Floods
  Directive style) if wanted: the backend would OR two flag sets.
