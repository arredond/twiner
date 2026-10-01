# pipelines/

Independent ETL pipelines that turn public data sources into the
static parquet/PMTiles files `services/scenario` reads at request time. Each
is its own `uv` workspace package (`twiner-faults`, `twiner-exposure`,
`twiner-fragility`) but they share one convention: fetch from a real public
source, write parquet (+ PMTiles for buildings), no database, no server —
see [`../docs/milestone-1-plan.md`](../docs/milestone-1-plan.md) §3 for why.

```
pipelines/faults      QAFI (IGME) -----------> faults.parquet
pipelines/exposure     Catastro (INSPIRE) ----> buildings.parquet (partitioned)
                                            \--> exposure.parquet
                                            \--> buildings.pmtiles
                        IGN/CNIG (ADR-0013) ---> municipalities.parquet
                                            \--> municipalities.pmtiles
pipelines/fragility    Martins & Silva (2020) -> fragility.parquet
pipelines/flood        MITECO SNCZI (ADR-0029) -> building_flood.parquet, zone_areas.parquet
                                            \--> flood_zones.pmtiles, flood_buildings.pmtiles
                                                        |
                                                        v
                                          services/scenario reads all five

pipelines/basemap      Protomaps daily build -> protomaps.pmtiles + fonts/sprites
                                                (the frontend's basemap only)
```

## `faults`: QAFI active faults

Downloads IGME's official QAFI v4 shapefile (`QAFI_Traces.rar`), extracts
the 201-fault attribute table, and resolves each fault's maximum magnitude:
uses QAFI's own published value where available (~60% of faults), falls
back to a length-based estimate (Wells & Coppersmith 1994) otherwise. See
[ADR-0004](../docs/decisions/0004-qafi-shapefile-source.md) for why the
official shapefile is used instead of IGME's ArcGIS REST layer (that layer
was found to have unreliable geometry for at least one fault).

Requires `unar` on `PATH` (`brew install unar`) to extract the RAR archive.

```bash
uv run python -m faults data/faults/qafi_faults.parquet
```

Output columns: `fault_id`, `name`, `section_name`, `length_km`, `mmax`,
`mmax_source` (`"qafi_v4_published"` or `"estimated_wells_coppersmith_1994"`),
`rake`, `dip`, `strike`, `geometry`. Nationwide by nature (only 201 rows) --
no regional variant needed.

## `exposure`: Catastro buildings -> exposure + geometry

The bulk of the data volume. Two entry points:

**Single municipality** (`exposure.__main__`, defaults to Lorca) --
downloads one municipality's INSPIRE Buildings GML from Catastro, parses
footprints/floors/construction year, assigns a taxonomy class heuristically
(no field survey -- see `taxonomy.py`'s docstring for the method and its
limits), and writes `buildings.parquet` + `exposure.parquet` (+ PMTiles if
requested). Good for local iteration on parsing/taxonomy logic without
waiting on a multi-hour crawl -- point it at a directory other than
`data/exposure` (the full national dataset, see below) so the two don't
collide.

```bash
uv run python -m exposure data/exposure-test/raw/lorca data/exposure-test/buildings.parquet \
    data/exposure-test/exposure.parquet data/exposure-test/buildings.pmtiles
```

**Region/national crawl** (`exposure.region_cli`) -- the same pipeline, run
across every municipality in a set of provinces, concurrently (default 8
workers), resumable (skips municipalities whose output already exists),
and disk-conscious (deletes each municipality's raw GML immediately after
parsing). See [ADR-0005](../docs/decisions/0005-region-scale-crawling.md).
`--spain` covers every province reachable through Catastro's national
feed (48 provinces -- excludes the Basque Country and Navarra, which run
separate Foral cadastral systems); `--basque-navarra` covers those
separately, on top of `--spain` or alone. `data/exposure` is the one
consolidated dataset the rest of the app expects -- there's no ongoing
reason to crawl a smaller subset (e.g. just Murcia + Andalucía) into its
own directory once you have this.

```bash
uv run python -m exposure.region_cli data/exposure/raw data/exposure/parts \
    data/exposure/exposure.parquet data/exposure/buildings.pmtiles \
    --spain --basque-navarra
```

Key design point: `buildings.parquet` from a region/national crawl is
**partitioned** (one file per municipality under `parts/`), never combined
into a single file -- `services/scenario` reads it via a glob pattern
(`parts/*.buildings.parquet`), and DuckDB's parquet reader uses each part's
column statistics to skip files that can't match a query's spatial filter
(see [ADR-0006](../docs/decisions/0006-precomputed-spatial-columns-and-adaptive-radius.md)).
`exposure.parquet` (attributes only, no geometry, much smaller) *is*
combined into one file.

If you already have `buildings.parquet` file(s) from before spatial index
columns existed, `exposure.backfill` retrofits them in place without
re-downloading:

```bash
uv run python -m exposure.backfill "data/exposure/parts/*.buildings.parquet"
```

### Municipal boundaries (`exposure.municipalities_cli`)

Downloads IGN/CNIG's national municipal-boundary dataset (one GML zip,
whole country, see [ADR-0013](../docs/decisions/0013-municipal-boundary-choropleth.md)
and [`../DATA-SOURCES.md`](../DATA-SOURCES.md)), derives each polygon's
5-digit INE code from IGN's own 11-digit `nationalCode` (its last 5
digits), and attaches an `n_buildings` count per municipality by counting
rows in whatever `<ine_code>.buildings.parquet` parts already exist under
a given `parts_dir` -- no new per-building processing. Independent of
region/province choice (always one national download); run it after an
`exposure`/`exposure.region_cli` crawl, pointed at that crawl's
`parts_dir`.

```bash
uv run python -m exposure.municipalities_cli data/exposure/muni_raw data/exposure/parts \
    data/exposure/municipalities.pmtiles data/exposure/municipalities.parquet
```

Two outputs: `municipalities.pmtiles` (the frontend's low-zoom choropleth
layer) and `municipalities.parquet`, a GeoParquet `services/scenario`
spatially joins scenario results against server-side
(`TWINER_MUNICIPALITIES_PATH`) to compute per-municipality aggregate
stats -- see ADR-0013 for why that join is DuckDB spatial rather than a
new geopandas/shapely dependency on the scenario service.

### Census sections + population (`exposure.census_sections_cli`)

Downloads INE's 2025 census-section boundaries and per-section population
by age, places every building in a section, and writes what the scenario
service's impact estimates read ([ADR-0024](../docs/decisions/0024-census-sections-and-impact-estimates.md),
[`../docs/impact-estimates.md`](../docs/impact-estimates.md)). Run after a
crawl, pointed at its `parts_dir`; ~1.5 minutes nationally.

```bash
uv run python -m exposure.census_sections_cli data/census/raw data/exposure/parts \
    data/census data/exposure/buildings-cloud-impact.parquet
cp data/census/sections.pmtiles apps/web/public/data/sections.pmtiles
```

Outputs: a `<code>.sites.parquet` sidecar per municipality part (the
columns the scenario engine reads, plus `census_section_code`,
`num_dwellings`, `built_area_m2`; resumable -- existing sidecars are
skipped), `data/census/{sections.parquet, sections_meta.parquet,
municipalities_meta.parquet, sections.pmtiles}`, and the compacted
`buildings-cloud-impact.parquet` that `bin/twiner` uses when present.

### Critical infrastructure (`exposure.infrastructure_cli`)

Hospitals, health centres, care homes, schools, universities, police and
emergency services, substations, power plants, bridges and inventoried dams
from IGN's Base Topográfica Nacional
([ADR-0025](../docs/decisions/0025-critical-infrastructure.md)). **Manual
download first**: CNIG refuses scripted downloads, so get the three
GeoPackage rows "BTN Tema - Servicios e instalaciones", "BTN Tema -
Energia" and "BTN Tema - Construcciones" from
<https://centrodedescargas.cnig.es/CentroDescargas/btn> and unzip them into
`data/infrastructure/raw/`. Then, after a crawl and the municipalities
step (it matches facilities to `parts_dir`'s buildings and assigns
municipalities from `municipalities.parquet`); ~45 seconds nationally:

```bash
uv run python -m exposure.infrastructure_cli data/infrastructure/raw data/exposure/parts \
    data/exposure/municipalities.parquet data/infrastructure
cp data/infrastructure/infrastructure.pmtiles apps/web/public/data/infrastructure.pmtiles
```

Outputs, in `data/infrastructure/`: `infrastructure.parquet` (every asset
with geometry), `infrastructure_sites.parquet` (the same without geometry
-- what the scenario service loads), `vs30_sites.parquet` (ESRM20's Vs30
grid, for the intensity bands) and `infrastructure.pmtiles` (two layers,
`points` and `shapes`, feature id = BTN id). The scenario service finds
them under `$TWINER_DATA_DIR/infrastructure/` (or `TWINER_INFRA_SITES_PATH`
/ `TWINER_VS30_SITES_PATH`); without them a scenario simply has no
infrastructure results.

### Province/CCAA outlines + area search (`exposure.admin_areas`)

The flood mode's area picker (ADR-0029): provinces and CCAA dissolved from
`municipalities.parquet` (so all three levels share edges), plus a compact
search index of every CCAA, province and municipality. ~20 seconds:

```bash
uv run python -m exposure.admin_areas data/exposure/municipalities.parquet data/exposure
cp data/exposure/admin_areas.pmtiles data/exposure/admin_index.json apps/web/public/data/
```

## `flood`: MITECO flood zones -> flood exposure + tiles

Fluvial flood zones for return periods T=10/50/100/500 from MITECO's SNCZI
([ADR-0029](../docs/decisions/0029-flood-scenarios.md), sources in
`DATA-SOURCES.md`). **Manual download first**: MITECO serves the six zips
behind a captcha, so get them by hand from
<https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html>
into `data/flood/raw/`, keeping their names (the CLI lists any missing one
with its URL). Then, after the exposure crawl, census sections
(`buildings-cloud-impact.parquet`, `sections.parquet`) and critical
infrastructure:

```bash
uv run python -m flood data/flood/raw data/exposure/parts \
    data/exposure/buildings-cloud-impact.parquet data/census/sections.parquet \
    data/infrastructure/infrastructure.parquet data/flood
cp data/flood/flood_zones.pmtiles data/flood/flood_buildings.pmtiles apps/web/public/data/
```

Steps, each skipped when its output exists (`--force` redoes all; the
per-return-period zones and per-province flags are also cached under
`data/flood/work/`, so an interrupted run resumes):

1. **Zones** (`zones.py`): each zone polygon is repaired, simplified with a
   1m tolerance, reprojected to EPSG:4326, cut by INE census section, and
   merged per (section, return period) -> `zones.parquet` (+
   `zone_areas.parquet` without geometry, what the scenario service loads).
2. **Buildings** (`exposure.py`): a building is flagged at a return period
   when its *footprint* intersects that period's zone. One worker per
   province, loading only nearby zone pieces -> `building_flood.parquet`,
   the flooded buildings only, one nullable boolean per return period
   (NULL = not mapped there: Canarias at T=10/T=50).
3. **Infrastructure**: the same test on each asset's geometry ->
   `infrastructure_flood.parquet`.
4. **Tiles** (`tiles.py`): `flood_zones.pmtiles` (layer `flood_zones`: `rp`,
   `sec`) and `flood_buildings.pmtiles` (layer `flood_buildings`:
   `building_id`, `sec`, `t10`..`t500`).

The scenario service reads `$TWINER_FLOOD_DIR` (default `data/flood`).

## `fragility`: Martins & Silva (2020) fragility functions

Downloads a curated subset of the [global fragility/vulnerability function
repository](https://github.com/lmartins88/global_fragility_vulnerability)
(CC BY-SA 4.0, per `fragility_curves/licence.txt`; cite Martins & Silva) -- the three GEM-taxonomy classes our exposure taxonomy
heuristic can produce (`CR_LDUAL-DUL` H1-H12; `MUR_LWAL-DNO` and
`MUR-STRUB_LWAL-DNO` H1-H5, all upstream publishes for them). See
[ADR-0032](../docs/decisions/0032-taxonomy-v2-unreinforced-masonry.md). See [`merisur.md`](../docs/merisur.md) §4.5/§4.9 and
[`milestone-1-plan.md`](../docs/milestone-1-plan.md) §2 for why generic
global fragility functions stand in for MERISUR's own Lorca-specific
capacity curves (not public), and
[`validation-lorca-2011.md`](../docs/validation-lorca-2011.md) for what
that substitution costs in accuracy.

```bash
uv run python -m fragility data/fragility/fragility.parquet
# Capacity curves for the capacity-spectrum damage model (ADR-0033):
# small, so bundled with the scenario service rather than written to data/.
uv run python -m fragility.capacity \
    services/scenario/src/scenario/vulnerability_data/martins_silva_2021_capacity.csv
```

Output is long-format: one row per (taxonomy, height_class, damage_state,
intensity value), giving cumulative exceedance probability at that
intensity. Nationwide/universal -- not region-specific, never needs
re-running for a bigger area.

## `basemap`: self-hosted Protomaps basemap

The default light/dark basemaps (ADR-0028). This step takes the latest
daily OpenStreetMap build from <https://maps.protomaps.com/builds/> and
cuts out a bbox with `pmtiles extract`. The extract fetches only the
bbox's tiles by range request, never the ~140GB planet. It also copies the
fonts and sprites the `@protomaps/basemaps` styles reference. Needs the
`pmtiles` CLI (`brew install pmtiles`). The 20260929 build's extract is
21.2GB and took 24 minutes on 2026-09-30. The server was slow that day:
the tile fetch ran at 48MB/s, but the archive directories took far longer
to read. build.protomaps.com is flaky, so the extract reads through a
retrying, resuming local proxy (`basemap/proxy.py`, see ADR-0028). If the
newest build is crawling (it may not be in Protomaps' CDN cache yet), a
`--build` from the day before is usually much faster.

```bash
uv run python -m basemap data/basemap \
    --upload s3://<DataBucketName>/tiles/basemap --profile twiner-admin
```

Options: `--build YYYYMMDD` picks a build other than the latest; `--bbox W,S,E,N`
sets the area (the default covers Spain, the Canaries and a good part of
Europe). Don't narrow it casually: the frontend reads the extract's header
bounds as the map's `maxBounds`. `--maxzoom` defaults to the builds' own 15.
`--force` redoes everything. Output, mirrored as-is under `tiles/basemap/`
in S3: `protomaps.pmtiles`, `fonts/`, `sprites/v4/` and a `protomaps.json`
manifest. A rerun whose build/bbox/maxzoom match the manifest skips the
extract, so rerunning just to refresh is cheap when there's no new build.
The frontend reads the basemap from S3 even in local dev (ADR-0028), so
`data/basemap` is only the staging copy for the upload.

## Where it all lands

`services/scenario` (see its own package for the request-handling side)
reads all five outputs -- `buildings.parquet`, `exposure.parquet`,
`fragility.parquet`, `faults.parquet`, `municipalities.parquet` -- via
configurable paths (`TWINER_BUILDINGS_PATH` etc., see
`scenario/local.py`/`handler.py`), so
switching between the Lorca, Murcia+Andalucía, or national dataset is an
environment-variable change, not a code change. `bin/twiner` (repo root)
starts the local dev stack against whichever dataset its env vars point at.
