# ADR-0025: Critical infrastructure and ground-motion intensity bands

Status: accepted (local only; see "Deploying" for what the cloud stack
still needs)

## Context

Scenario output stopped at ordinary buildings: a damage state per building,
rolled up to census sections and municipalities (ADR-0013/0014/0024).
Emergency response also needs to know what happens to *critical
infrastructure*. Some of it is buildings (hospitals, care homes, schools,
emergency services); some isn't (substations, power plants, bridges, dams).
For the non-buildings we have no vulnerability model, so the useful answer
is "how hard is this asset shaken". "Inside the evaluated radius" is not
that answer: the radius is a search bound, not an affected area, and it
overstates impact (the affected-vs-evaluated distinction of ADR-0024).

### Sources (investigated 2026-09-29)

**Catastro can't tell a hospital from a school.** Its INSPIRE feed, which
we already crawl, has one coarse use for all of them: `4_3_publicServices`
(193,861 buildings nationally with the Foral sources' `publicServices`).
Finer use codes exist only in Catastro's registered (Cl@ve) bulk
alphanumeric files.

**IGN's Base Topográfica Nacional (BTN) has what we need** (CC BY 4.0,
1:25,000, update of 26/06/2026; layer spec in
[ESPBTN.pdf](https://www.ign.es/resources/docs/IGNCnig/BTN/ESPBTN.pdf)). It
ships as national GeoPackages per theme. What we use:

| BTN layer (theme file) | Kept | Count |
|---|---|---|
| `0590P` Servicios e instalaciones (Servicios e instalaciones, 28.75 MB) | school, university, hospital, health centre, care home, police/security, emergencies (fire, civil protection) | 40,262 |
| `0719S` Transformación eléctrica (Energía, 37.73 MB) | substations | 3,532 |
| `0713S` Central eléctrica (Energía) | all plant types | 5,743 |
| `0710L` Línea eléctrica (Energía) | only to describe a substation's voltage | – |
| `0546L` Paso elevado (Construcciones, 857.36 MB) | bridges in use | 163,061 |
| `0552L` Presa (Construcciones) | dams in MITECO's dam inventory | 1,533 |

Counts are after dropping features outside Spain (below); 214,131 assets
in all. Other checks:
- **Registry ids come with the points.** Hospitals carry the Ministry of
  Health's national hospital catalogue (CNH) id (869 of 882 in the raw
  layer), and schools and universities their national registry (RCD/RUCT)
  id (32,913 of 32,944 schools), so the registries are already located.
- **Dams need filtering.** BTN also captures every pond and
  irrigation-reservoir embankment as a "presa" (28,213 features). Only the
  1,533 with an IPE (dam inventory) id are dams in the sense an emergency
  planner means.
- **BTN is ETRS89 (EPSG:4258)**, and it stores type attributes as bare codes
  (`04`), not the `04 HOSPITAL` labels its vector tiles show.
- **Other sources, not chosen:**
  - *IDEE OGC API Features* ([`api-features.idee.es`](https://api-features.idee.es/collections)):
    scriptable, with INSPIRE dams, aerodromes, ports and road/rail links,
    but no facilities or energy, and no bridge flag on road links.
  - *IGN ATOM feed*: publishes no BTN.

## Decision

### Data (`pipelines/exposure` `infrastructure.py`, `infrastructure_cli`)

**The BTN download is manual.** CNIG's download endpoint
(`initDescargaDir`) returns 403 to scripted requests, even with the page's
session cookie and AJAX headers. The page's `descargaDirS3` route hands out
a presigned URL to a *development* bucket where the file doesn't exist. We
don't work around the block. Instead:
1. Download the three theme GeoPackages above by hand from
   [the BTN download page](https://centrodedescargas.cnig.es/CentroDescargas/btn).
2. Unzip them into `data/infrastructure/raw/`.

The pipeline fails with a message pointing back here if a file is missing.

**One row per asset**, keyed by the BTN `id`: the GeoPackage FID, unique
across all five layers (287,472 ids checked, before filtering). Columns:
- `category` and `subtype`, plus `name`;
- `detail`: substation voltage or bridge length;
- `registry_id`: the CNH, RCD/RUCT or IPE id;
- a representative point (GEOS PointOnSurface), which stays inside a
  polygon and on a line;
- `municipality_code`, `vs30` and `building_id`, below.

The build takes ~45 seconds nationally.

- **Municipality**: IGN municipal polygons (`ine_code`), nearest within
  1 km for points just off the coast. BTN's map sheets run past the
  border, and 2,261 features (almost all bridges) fall in France, Andorra
  or Portugal, more than 1 km from any Spanish municipality. They're
  dropped.
- **Vs30**: ESRM20, looked up exactly as for buildings (ADR-0015). 6,210
  assets have none: all of Canarias (the ESRM20 Spain grid doesn't cover
  the islands) and grid holes such as reservoirs, where many bridges are.
  The scenario service falls back to `DEFAULT_VS30` for these, as it does
  for buildings.
- **Facility → building, precomputed once** (as with ADR-0014/0024, the
  relationship never changes). Each `0590P` point is matched to the
  Catastro footprint that contains it, else to the nearest footprint
  within 30 m, else to nothing.
  - Result: 39,809 of 40,262 facilities matched, 38,875 inside a
    footprint and 934 by nearest.
  - Several facilities can share one building (a campus parcel holding
    four schools).
  - The candidate search buckets both sides into ~450 m cells and
    equi-joins on the cell, rather than a lon/lat range join, which would
    compare each point with a whole longitude strip of Spain.
- **Substation voltage** is the highest `0710L` voltage within 30 m. It's
  display only.
- **Outputs**:
  - `infrastructure.parquet` (with geometry);
  - `infrastructure_sites.parquet` (what the scenario service loads);
  - `vs30_sites.parquet` (the ESRM20 grid, 1.6 MB, for the bands);
  - `infrastructure.pmtiles` (50 MB): layers `points` (every asset) and
    `shapes` (polygon/line assets, z12+), with feature id = asset id.
    Each category starts at its own zoom (health, power and dams z5;
    emergency and care z7; education z9; bridges z10) instead of
    tippecanoe dropping features by density, since a dropped hospital
    would be a wrong answer.

### Intensity: per asset, and as bands

**Intensity is Worden et al. (2012) from PGV.** The equations are the ones
USGS ShakeMap implements as WGRW12 (coefficients checked against its
source), without the optional distance/magnitude residual terms. They're
applied to the scenario GMPE's own PGV (Akkar et al. 2014 supports it). PGV
was chosen over the PGA equation for its slightly lower scatter (0.63 vs
0.66 intensity units). MMI and EMS-98 are broadly equivalent at these
levels (Musson, Grünthal & Stucchi 2010), so the UI labels it "EMS-98
(est.)", the scale Spain's seismic civil protection uses.

**Every asset in the scenario's site box gets an intensity.** The box is
`engine.site_box`, now shared with the building query. The asset is
evaluated on the same 1 km `GriddedIntensity` cells as the buildings, with
its own Vs30 and the scenario's `sigma_multiplier`, so an asset and the
building beside it see the same shaking at the chosen probability level.

**What gets returned:**
- An asset is returned if its intensity is at least **VI**, EMS-98's
  "slightly damaging" (`AFFECTED_INTENSITY`).
- A facility is also returned below VI if its building came out damaged.
- Facilities carry their building's result from this same run, which is
  the building model everything else uses: `damage_state_code` *and* the
  full distribution (`damage_probs`). The engine tracks the facilities'
  buildings (`summarize_scenario(track_building_ids=...)`) so that even a
  confidently undamaged one, which the tile joins don't list, reports its
  distribution. That adds no measurable time.
- A facility whose building wasn't evaluated, and every non-building
  asset, carries `null`: there's no damage estimate, and the UI says so.
- Rows also carry the asset's lon/lat for the sidebar's zoom-to.

**Bands.** The same PGV → intensity is evaluated on a regular grid over
the site box:
- **Cells:** at least 1 km, coarser for large boxes (at most 400 cells per
  side). Each cell uses its nearest ESRM20 Vs30.
- **Contours:** `contourpy` (a new, small scenario dependency) turns the
  grid into one (multi)polygon per integer level from IV up, simplified by
  half a cell.

**Storage and routes:**
- Two new per-scenario artifacts: `infrastructure.json.gz` and
  `intensity.geojson.gz`.
- Two new routes in both `local.py` and `handler.py`:
  `GET /results/{id}/infrastructure[?municipality_code=]` and
  `GET /results/{id}/intensity`.
- The response gains `infrastructure_summary` (affected assets by
  category, or `null` with no infrastructure data deployed; the building
  results are unaffected either way). `API_VERSION` 6.

**Measured** (local, national data, Alhama de Murcia fault ES626):

| Probability level | Buildings evaluated | Scenario time | Affected assets | Rows on the wire | Bands (gz) |
|---|---|---|---|---|---|
| high | 1.67M | 1.2 s | 1,082 | 10 KB | 20 KB |
| very low | 4.27M | 2.2 s | 3,650 | 36 KB | 37 KB |

The infrastructure and bands step itself takes 0.14 s (high) and 0.29 s
(very low). Hospital Rafael Méndez (Lorca) comes out at VII (7.1) with
Slight damage at "high", and VIII (8.1) with Extensive damage at "very
low".

**Sanity check against Lorca 2011** (Mw 5.2 point source, as in
docs/validation-lorca-2011.md). With the town's Vs30 of 383 m/s, the
estimate for Lorca town is 5.7 at "high" and 6.6 at "low"/"very low"
(+1σ). IGN's observed maximum was VII (EMS-98).
- *At the median*, the GMPE is short: its median PGA there (0.18 g) is
  about half the ~0.36 g recorded.
- *At +1σ*, the ground motion matches the record (0.367 g), and the
  conversion is what falls short: PGV-based gives 6.6, PGA-based 7.9, and
  PGA with WGRW12's magnitude/distance terms 7.1.

One event isn't grounds for retuning. docs/validation-lorca-2011.md §12
has the comparison and the tuning options, the first being validation
against IGN's full intensity data.

### Frontend

- **One legend, with every toggle inline in its section header:**
  - *Damage* (on by default): one switch for buildings, the
    municipality/section choropleths and debris. Off hides the choropleths
    and debris and draws buildings uncoloured.
  - *Intensity (EMS-98, est.)* (off): the bands, IV–X, in ColorBrewer's
    sequential Blues, kept apart from the damage palette (green–red) and
    the fault lines (purple). They sit under every choropleth and building
    layer, at 35% opacity. The switch is enabled once a scenario's bands
    have loaded.
  - *Critical infrastructure* (off): a master switch meaning "any category
    on", then one inline row per category (letter badge, name, affected
    count after a run, switch). Categories: Health (H), Care homes (C),
    Emergency services (E), Education (S), Power (P), Bridges (B), Dams (D).
- **Map:**
  - Assets are circles with their category letter (letters from z10) and,
    from z12, their real shapes.
  - After a run, affected assets are filled with their intensity band's
    colour, the same scale as the bands, for every category. The rest fade.
  - A click shows type, voltage or length, registry id, Catastro building,
    intensity, and for facilities their building's damage state *with its
    full probability distribution*. Otherwise the popup says "below VI" or
    "outside the evaluated area".
- **Sidebar:** a "Critical infrastructure affected (N)" section, collapsed
  by default, both for the whole scenario and in a municipality's
  drill-down.
  - Assets are grouped by category, each group collapsed too
    ("Bridges (27)"), most intense first, 50 per page.
  - Each row shows its intensity chip, name and type, and for facilities
    the damage state with a thin distribution bar.
  - Clicking an asset switches its category's layer on, flies the map to it
    and opens its popup.

## Alternatives considered

- **HAZUS lifeline fragility curves.** These were investigated first:
  NHERI SimCenter's machine-readable copy of the Hazus tables, since
  FEMA's PDF blocks scripted download. Rejected, because BTN doesn't carry
  the inputs they need:
  - *Bridges:* HWB classes need material, continuity, span count and
    length, bent type and design era. BTN has only type, status and road
    segment, and plausible default classes differ about 3x in median
    capacity (0.25 g vs 0.80 g SA(1.0s) at Slight), so the default we
    picked would drive the answer.
  - *Substations:* voltage was derivable, but anchorage isn't recorded
    anywhere.
  - *Power plants:* BTN has no capacity.
  - *Dams:* Hazus has no dam fragility at all.

  That would have left a damage model for one category, built on assumed
  inputs. Intensity is the same kind of answer for every asset and
  doesn't pretend to know the structure.
- **Catastro's alphanumeric bulk files for facility use.** They need a
  registered download, and a use code doesn't say "this is *the*
  hospital" the way BTN's CNH/RCD ids do.
- **Catastro-only detection** (`publicServices` → critical). Too coarse:
  it mixes libraries, sports halls and cemeteries in with hospitals.
- **Geocoding CNH/RCD ourselves.** BTN already carries their ids on
  located points.
- **OpenStreetMap.** It's not an official source, and the requirement was
  official data first.
- **"Affected" = inside the evaluated radius.** It overstates impact (see
  Context).
- **Every BTN "presa" as a dam.** 28,213 features, mostly pond
  embankments.
- **Intensity from PGA, or PGA and PGV combined.** Either reads higher at
  Lorca 2011 (PGA with WGRW12's magnitude/distance terms comes closest to
  the observed VII), but one event isn't a reason on its own. Left as
  tuning options in docs/validation-lorca-2011.md §12. PGV has the lower
  published scatter.

## Consequences

- **New manual setup step:** the BTN download (README quickstart 1d,
  pipelines/README.md, DATA-SOURCES.md).
- **Scenario service:** one more per-process static load (~214k asset
  rows, plus the Vs30 grid on first use), 0.1–0.3 s more per scenario,
  and two small stored artifacts per scenario.
- **Coverage gaps:** municipalities with affected infrastructure but no
  damaged buildings aren't listed in the sidebar, which only lists
  damaged municipalities; their assets still show on the map. Canarias
  assets use the default Vs30.
- **Deploying** (not done; needs its own go-ahead):
  - upload `infrastructure_sites.parquet` and `vs30_sites.parquet` to the
    data bucket and set `TWINER_INFRA_SITES_PATH`/`TWINER_VS30_SITES_PATH`
    in `infra/stacks/twiner_stack.py`;
  - upload `infrastructure.pmtiles` next to the other tiles;
  - bump `DATA_VERSION`;
  - rebuild the image (new `contourpy` dependency) and re-warm the cache.

  Per the "test in the built image" rule, run a scenario inside the built
  image first, including an `s3://` read of the sites file. Until then the
  deployed API returns `infrastructure_summary: null`, and bands with the
  default Vs30.
- **Follow-ups:**
  - water treatment and transport hubs (BTN `0570S`, `0650S`/`0657S`/`0662S`);
  - MITECO's IPE risk category for dams;
  - generation capacity for plants;
  - a structural bridge inventory (via UPM), which would reopen the
    damage-model question for bridges.
