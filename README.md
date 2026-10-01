# twiner

A digital twin for multi-hazard risk assessment in Spain: earthquakes
(twinQUAKE) and fluvial floods (twinFLOOD, from MITECO's flood zones --
[ADR-0029](docs/decisions/0029-flood-scenarios.md)). Milestone 1 built a modern clone of UPM's
[MERISUR](docs/merisur.md) web simulator, prototyped against Lorca;
milestone 2 expanded exposure coverage region by region -- Murcia +
Andalucía first, then nationwide via Catastro's INSPIRE feed, then the
Basque Country and Navarra (which run separate Foral cadastral systems, so
they needed their own crawlers -- see
[`docs/decisions/0005-region-scale-crawling.md`](docs/decisions/0005-region-scale-crawling.md)
and [`docs/basque-navarra-cadastral-sources.md`](docs/basque-navarra-cadastral-sources.md)).
All of Spain is now covered, in the single `data/exposure` dataset (the
Lorca-only and Murcia+Andalucía-only datasets those milestones used along
the way have been retired).
User-facing documentation (the science behind each hazard, data sources,
API reference, in English and Spanish) is the site in `apps/docs/`, served
at <https://twiner.arredon.do/docs/> and locally by `bin/twiner start` at
http://localhost:5173/docs/ ([ADR-0031](docs/decisions/0031-documentation-site.md)).
See [`docs/milestone-1-plan.md`](docs/milestone-1-plan.md) for the
milestone-1 plan, [`docs/decisions/`](docs/decisions/) for architecture
decisions, and [`DATA-SOURCES.md`](DATA-SOURCES.md) for every external
dataset in use, with links to the actual resource (ATOM feed / WFS
endpoint) rather than a homepage.

## Layout

```
apps/web/         React + MapLibre frontend
apps/docs/        Documentation site (Astro Starlight), served under /docs
services/scenario/  Scenario function (rupture -> ground motion -> damage);
                     runs as a local dev server or an AWS Lambda
pipelines/           Three ETL pipelines (faults, exposure, fragility) --
                     see pipelines/README.md for how each works
infra/               AWS CDK app (S3 buckets + scenario Lambda)
docs/                Research notes, plans, and architecture decisions
bin/twiner            Start/stop/restart the local dev stack (see below)
```

Python packages are a `uv` workspace (one `.venv` for everything under
`services/` and `pipelines/`); the frontend and the docs site are separate
npm projects under `apps/web/` and `apps/docs/`.

## Quickstart

Requires: `uv`, Node.js, [`tippecanoe`](https://github.com/felt/tippecanoe)
(`brew install tippecanoe`).

```bash
uv sync --all-packages

# 1. Run the data pipelines (writes into ./data/, gitignored). The
# exposure crawl covers all of Spain -- Catastro's national INSPIRE feed
# via --spain, plus the Basque Country/Navarra's own separate Foral
# cadastral systems via --basque-navarra (resumable, safe to re-run/Ctrl-C
# -- see docs/decisions/0005-region-scale-crawling.md and
# pipelines/README.md). buildings.parquet ends up *partitioned*
# ("data/exposure/parts/*.buildings.parquet") -- there's no single
# combined buildings file, by design (see region.py's own docstring);
# exposure.parquet is combined into one file.
uv run python -m faults data/faults/qafi_faults.parquet   # requires `unar` (brew install unar)
uv run python -m exposure.region_cli data/exposure/raw data/exposure/parts \
    data/exposure/exposure.parquet data/exposure/buildings.pmtiles \
    --spain --basque-navarra
uv run python -m fragility data/fragility/fragility.parquet

# 1b. Municipal boundaries + aggregate stats (ADR-0013) -- powers the map's
# low-zoom choropleth. Needs the parts_dir from step 1 to count buildings
# per municipality. Independent of the exposure crawl otherwise -- always
# one national download.
uv run python -m exposure.municipalities_cli data/exposure/muni_raw data/exposure/parts \
    data/exposure/municipalities.pmtiles data/exposure/municipalities.parquet

# 1c. INE census sections + population (ADR-0024) -- powers the impact
# sidebar (population, cost, debris...) and the mid-zoom section
# choropleth. Also writes data/exposure/buildings-cloud-impact.parquet,
# which bin/twiner uses whenever it exists.
uv run python -m exposure.census_sections_cli data/census/raw data/exposure/parts \
    data/census data/exposure/buildings-cloud-impact.parquet

# 1d. Critical infrastructure (ADR-0025): hospitals, schools, substations,
# bridges... from IGN's BTN. The three BTN theme GeoPackages are a MANUAL
# download into data/infrastructure/raw/ first -- see pipelines/README.md.
uv run python -m exposure.infrastructure_cli data/infrastructure/raw data/exposure/parts \
    data/exposure/municipalities.parquet data/infrastructure

# 1e. (Shelved, ADR-0026) Road network for drawing traffic stretches as
# lines: IGN's "Redes de transporte" roads GeoPackage is a MANUAL download
# into data/roads/raw/ first -- see pipelines/exposure/src/exposure/roads.py.
# Only used with TWINER_TRAFFIC_LINES=1.
uv run python -m exposure.roads_cli data/roads/raw data/roads

# 1f. Floods (ADR-0029). Province/CCAA outlines + area search index first
# (from 1b's municipalities), then MITECO's flood zones: the six zips are a
# MANUAL download into data/flood/raw/ (they sit behind a captcha; the CLI
# lists any missing one with its URL -- see pipelines/README.md). Needs 1c
# and 1d's outputs. ~45 minutes nationally, resumable.
uv run python -m exposure.admin_areas data/exposure/municipalities.parquet data/exposure
uv run python -m flood data/flood/raw data/exposure/parts \
    data/exposure/buildings-cloud-impact.parquet data/census/sections.parquet \
    data/infrastructure/infrastructure.parquet data/flood

# 2. Copy whichever buildings.pmtiles/debris.pmtiles/municipalities.pmtiles
# you built into the frontend's static assets
cp data/exposure/buildings.pmtiles apps/web/public/data/buildings.pmtiles
cp data/exposure/municipalities.pmtiles apps/web/public/data/municipalities.pmtiles
cp data/census/sections.pmtiles apps/web/public/data/sections.pmtiles
cp data/infrastructure/infrastructure.pmtiles apps/web/public/data/infrastructure.pmtiles
cp data/flood/flood_zones.pmtiles data/flood/flood_buildings.pmtiles apps/web/public/data/
cp data/exposure/admin_areas.pmtiles data/exposure/admin_index.json apps/web/public/data/

# 3. Start both the scenario API and the frontend together
npm install --prefix apps/web
./bin/twiner start   # see `twiner status`/`twiner attach`/`twiner stop`/`twiner restart`
```

Open http://localhost:5173. The top-left corner has one card per hazard;
clicking a card's name opens it (and closes the other).

- **twinQUAKE** (open at start): pick a mode and probability level. In
  Automatic mode, click a fault (dashed purple line) to run its
  maximum-magnitude earthquake; in Manual mode, click anywhere on the map
  to configure an earthquake there. The map colors buildings by resulting
  damage state.
- **twinFLOOD**: pick a return period (T10/T50/T100/T500) and an area --
  draw a circle (click the centre, then the edge), click a CCAA / province
  / municipality, or search for one. The map shows the flood zones, the
  buildings in them, and the affected municipalities / census sections.

Either way, the right-hand scenario panel lists affected municipalities
(population, cost, debris for earthquakes; buildings, residents and
flooded area for floods -- rough estimates, see docs/impact-estimates.md)
and drills into their census sections. Closing the panel, or clicking the
card's name again, clears the scenario.
`bin/twiner` defaults to whichever dataset `TWINER_BUILDINGS_PATH`/
`TWINER_EXPOSURE_PATH` point at (see the script's own comments) -- set
those env vars before `twiner start` to point at a different one, e.g. a
single-municipality test crawl (`uv run python -m exposure <raw_dir>
<buildings.parquet> <exposure.parquet> <buildings.pmtiles>`, pointed at a
directory other than `data/exposure` so it doesn't collide with the full
national dataset) instead of the full national crawl above.

The scenario result cache (ADR-0018) is **off** locally by default: every
run recomputes. Use `TWINER_SCENARIO_CACHE=1 twiner start` to exercise it,
and bump `TWINER_DATA_VERSION` after rebuilding local data while it's on.
The deployed stack has it on. Bump `API_VERSION` in
`services/scenario/src/scenario/scenario_id.py` whenever a change could
alter scenario results, and `DATA_VERSION` in
`infra/stacks/twiner_stack.py` whenever you upload new data.
After either bump and a deploy, `bin/warm-scenario-cache` pre-computes every
fault x probability level against the deployed API.

## Working in multiple worktrees

`data/` and `apps/web/public/data/` are gitignored (the pipeline outputs
above run into the multi-GB range) and a `git worktree` doesn't share a
working directory with the one it was added from, so a fresh worktree has
neither by default. Run `bin/link-data` from inside a new worktree to
symlink both to the main worktree's copies instead of re-running the ETL
there -- it's a no-op in the main worktree itself, and refuses to touch
either path if it already has real content.

## Tests

```bash
uv run pytest              # all Python packages
cd apps/web && npx tsc --noEmit && npm run build   # also builds the docs into dist/docs/
```

`services/scenario/tests/test_api_reference.py` fails when the docs' API
reference is stale: run `bin/export-openapi` after changing a scenario API
route or `api_models.py`.

## Cloud deployment

See [`docs/decisions/0016-cloud-deployment.md`](docs/decisions/0016-cloud-deployment.md)
for the architecture (AWS Lambda + S3 backend, Cloudflare Pages frontend),
[`docs/deploy-aws-setup.md`](docs/deploy-aws-setup.md) for AWS account
setup + `cdk deploy` + data upload, and
[`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) for the frontend.

## Dev tooling

- **Linting/formatting**: [`ruff`](https://docs.astral.sh/ruff/) (`uv run ruff check .`, `uv run ruff format .`).
- **Type checking**: [`pyrefly`](https://pyrefly.org/) (`uv run pyrefly check`).
- **Pre-commit hooks** run both automatically: `uv run pre-commit install` once per clone, then every commit runs `ruff check --fix`, `ruff format`, and `pyrefly check`. Run manually over everything with `uv run pre-commit run --all-files`.

## License

- **Code**: [GNU AGPL v3.0 or later](LICENSE). The scenario service
  builds on OpenQuake's `hazardlib`, itself AGPL v3. The web app links to
  this repository from its settings menu, which is the source offer the
  AGPL requires for network use.
- **Documentation** (`apps/docs/`): [CC BY 4.0](apps/docs/LICENSE).
- **Data**: every input dataset keeps its publisher's licence
  ([`DATA-SOURCES.md`](DATA-SOURCES.md)). Data derived from QAFI is
  CC BY-SA 4.0, and the OpenStreetMap basemap is ODbL. The Martins & Silva
  fragility functions have no formal licence (free use with citation).
