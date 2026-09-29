# ADR-0025: Critical infrastructure and ground-motion intensity bands

Status: proposed (sources and approach decided; nothing built yet. The
BTN download is manual, see "Data"; the HAZUS checks in "Damage models"
run once that data is in)

## Context

Scenario output stops at ordinary buildings: a damage state per building,
rolled up to census sections and municipalities (ADR-0013/0014/0024).
Emergency response also needs to know what happens to *critical
infrastructure*:
- **Buildings with a critical use**: hospitals, care homes, schools,
  emergency services, police.
- **Non-buildings**: substations, power plants, bridges, dams, and
  later water treatment and transport hubs.

We have no vulnerability class for most of the non-buildings, so the
minimum useful answer for them is "how hard is this asset shaken".
"Inside the evaluated radius" is not that answer. The radius is a search
bound, not an affected area, and it overstates impact (see ADR-0024's
affected-vs-evaluated distinction).

### What the sources offer (investigated 2026-09-29)

**Catastro can't tell a hospital from a school.** Its INSPIRE feed, which
we already crawl, has one coarse `currentUse` for all public buildings:
`4_3_publicServices`, 193,861 buildings nationally once combined with the
Foral sources' `publicServices`. Finer use codes exist only in Catastro's
bulk alphanumeric files, which need a registered (Cl@ve) download.

**IGN's Base Topográfica Nacional (BTN) has almost everything we need**
(CC BY 4.0, 1:25,000, last update 26/06/2026). The layer spec is
[ESPBTN.pdf](https://www.ign.es/resources/docs/IGNCnig/BTN/ESPBTN.pdf).

| BTN layer | What we use | Geometry | Useful attributes |
|---|---|---|---|
| `0590P` Servicios e instalaciones | school (01), university (02), hospital (04), other health centre (05), care home (06), police/security (21), emergencies/fire/civil protection (22), town hall (23) | point, placed on the facility's main building | `id_hos`: the Ministry of Health's national hospital catalogue (CNH) id. `id_edu`: the national school registry (RCD) id |
| `0719S` Transformación eléctrica | substation (01) | polygon | none beyond type |
| `0710L` Línea eléctrica | used only to derive substation voltage | line | `tensi_0710`: <100 / 100–150 / 220 / 400 kV |
| `0713S` Central eléctrica | thermal, hydro, nuclear, combined cycle, PV, wind, solar thermal | polygon | type only, no capacity |
| `0546L` Paso elevado | bridge (02); footbridges and fords excluded | line | `estad_0546`, `id_tramo` (the road/rail segment), nothing structural |
| `0552L` Presa | dams | line | `ID_PRESA`: id in MITECO's national dam inventory (IPE) |
| `0570S`, `0331S` | water treatment, desalination, wastewater, water tanks (phase 2) | polygon | type |

The layers ship as national GeoPackages, one per BTN theme:

| Theme file | Size | Layers used |
|---|---|---|
| Servicios e instalaciones | 28.75 MB | `0590P`, `0570S` |
| Energía | 37.73 MB | `0710L`, `0713S`, `0719S` |
| Construcciones | 857.36 MB | `0546L`, `0552L`, `0331S` |

**Checked against real BTN data.** The vector tiles at
`vt-btn.idee.es/1.0.0/btn/tile/{z}/{y}/{x}.pbf` carry the full
attributes. Sampling around Lorca:
- **Facility join:** 43 of 45 `0590P` points fall inside one of our
  Catastro footprints (`30024.buildings.parquet`), almost all tagged
  `4_3_publicServices`. The other 2 are 13 m and 25 m from the nearest
  building's centroid.
- **Registry ids:** the Hospital Virgen del Alcázar carries `id_hos`
  300217, and schools carry their `id_edu`.
- **Shared buildings:** several facilities share one Catastro building
  (four schools on `5301030XG1750A`), so the join is many-to-one.
- **Substation voltage:** the one substation in a 7x7 z14 tile block
  touches 100–150 kV lines, which is enough to give it a voltage class.
- **Bridges:** of 118 `0546L` features in the same block, 40 are bridges
  and 78 are fords. None has an attribute beyond type, status and road
  segment.

**Other official sources, checked and not chosen as primary:**
- **IDEE OGC API Features**
  ([`api-features.idee.es`](https://api-features.idee.es/collections)):
  scriptable. It has INSPIRE dams (`damorweir`, 28,774 including small
  ponds and weirs), aerodromes, ports and road/rail links. It has no
  facilities or energy layers, and its road links have no bridge flag.
  It's a fallback for transport only.
- **IGN ATOM feed**: only publishes administrative boundaries, place
  names and hydrography, not BTN.

## Decision

### Data (new `pipelines/exposure/.../infrastructure.py` and `infrastructure_cli`)

**The BTN download is manual.** CNIG's download endpoint
(`initDescargaDir`) returns 403 to scripted requests, even with the
page's session cookie and AJAX headers. The page's alternative
`descargaDirS3` route hands out a presigned URL to a *development*
bucket where the file doesn't exist. We don't work around the block.
Instead:
1. Download the three theme GeoPackages above by hand from
   [centrodedescargas.cnig.es/CentroDescargas/btn](https://centrodedescargas.cnig.es/CentroDescargas/btn).
2. Unzip them into `data/infrastructure/raw/` in the main checkout.
   Worktrees reach that directory through `bin/link-data`.

This is a one-time download plus a refresh when IGN republishes. The
pipeline checks for the expected file names and fails with a message
pointing back here.

**Output: one `infrastructure.parquet`**, one row per asset, with these
columns:
- `asset_id`: BTN `id`, unique per feature.
- `category`: health, care, education, emergency, power_substation,
  power_plant, bridge, dam, water.
- `subtype` and `name`.
- `geometry` plus a representative point (`lon`, `lat`).
- `municipality_code`: point-in-polygon against IGN municipalities, the
  same key everything else uses (ADR-0014).
- `vs30`: sampled from ESRM20 like buildings (ADR-0015).
- `registry_id`: `id_hos`, `id_edu` or `ID_PRESA`, where present.
- `building_id`: for facilities that are buildings (see below).
- `hazus_class`: where a damage model applies (see "Damage models").

**Facility → building join, computed once at build time**, for the same
reason as ADR-0014/0024: the relationship never changes. Each `0590P`
point is matched to the Catastro building whose footprint contains it,
or else to the nearest building within 30 m. Several facilities can map
to one building. A facility with no match inside 30 m is kept as a
non-building asset (intensity only), not dropped.

**Substation voltage** is the highest voltage (`0710L`) among lines
within 30 m of the substation polygon. A substation with no line nearby
gets `voltage = unknown`.

**Tiles:** `infrastructure.pmtiles` with one layer per geometry type and
`promoteId: asset_id`. `asset_id` is unique per feature. A shared id
can't drive per-feature feature-state, which is the debris-ring problem.

### Intensity: per asset, plus a map layer of bands

**Scale.** Intensity is reported as macroseismic intensity, converted
from the GMPE's PGA/PGV with a published ground-motion-to-intensity
conversion (GMICE). Candidates are Worden et al. (2012), which USGS
ShakeMap uses, or a European-calibrated alternative; the choice is made
during implementation. Spain's official scale is EMS-98. MMI and EMS-98
are broadly equivalent over the range that matters here (Musson,
Grünthal & Stucchi 2010), and we label the result "EMS-98 (est.)". A
roman-numeral intensity is also the vocabulary Spanish civil protection
plans already use, which raw PGA isn't.

**Per asset.** The scenario evaluates PGA (and SA(1.0s) where a damage
model needs it) at every asset in range. It uses the existing
`compute_intensity` with the asset's own Vs30 and the scenario's
`sigma_multiplier`, so an asset's intensity matches the probability level
the buildings used. There are tens of thousands of assets nationally, a
rounding error next to the millions of buildings the engine already
streams.

**"Potentially affected" means estimated intensity ≥ VI** at the asset,
the EMS-98 onset of slight damage. This number is a proposal to confirm.
It lines up with the Directriz básica de planificación de protección
civil ante el riesgo sísmico, which also uses intensity VI as its
planning threshold (exact wording to be checked when citing it). Only
assets at or above the threshold are returned.

**Bands layer.**
- **Computation:** the server evaluates the same GMPE on a regular grid
  over the evaluated region, reusing `GriddedIntensity`'s cell scheme.
  Grid cells use ESRM20 Vs30, so the bands include site amplification
  like everything else. The grid is contoured into one polygon per
  integer intensity level (IV and up), simplified, and stored per
  scenario next to `section_stats`.
- **Delivery:** a new route, `GET /results/{id}/intensity`, serves the
  polygons as GeoJSON. This keeps the scenario response thin (ADR-0019).
- **Map:** it's a separate layer with its own toggle, off by default. It
  sits under the buildings and choropleths, semi-transparent. Its palette
  must not collide with `DAMAGE_COLORS`.

### Damage models: HAZUS where the inputs exist, intensity elsewhere

The HAZUS lifeline fragility curves were taken from NHERI SimCenter's
Damage and Loss Model Library (`src/dlml/data/seismic/{power_network,
transportation_network}/portfolio/Hazus v5.1/fragility.csv`). That library
is a machine-readable copy of the Hazus Earthquake Technical Manual
tables. FEMA's own PDF blocks scripted download, so the transcription
still needs a cross-check against the manual.

All curves are lognormal with four damage states, Slight to Complete,
the same four as our building damage states. They use PGA or SA(1.0s),
and the engine's GMPE (Akkar et al. 2014) already computes both.
Plugging them in is a data problem, not a new model.

**Medians** below are PGA or SA(1.0s) in g, for Slight / Moderate /
Extensive / Complete:

| Class | Demand | Medians (g) | Needs |
|---|---|---|---|
| Substation, low voltage, anchored / unanchored (`EP.S.L.A` / `.U`) | PGA | 0.15/0.29/0.45/0.90 · 0.13/0.26/0.34/0.74 | voltage, anchorage |
| Substation, medium voltage (`EP.S.M.A` / `.U`) | PGA | 0.15/0.25/0.35/0.70 · 0.10/0.20/0.30/0.50 | voltage, anchorage |
| Substation, high voltage (`EP.S.H.A` / `.U`) | PGA | 0.11/0.15/0.20/0.47 · 0.09/0.13/0.17/0.38 | voltage, anchorage |
| Generation plant, small (`EP.G.S.*`) / medium-large (`EP.G.ML.*`) | PGA | e.g. `EP.G.ML.U` 0.10/0.22/0.49/0.79 | capacity (small < 100 MW), anchorage |
| Highway bridge, 28 classes (`HWB.GS.1`–`28`) | SA(1.0s) | from 0.25/0.35/0.45/0.70 (`HWB5/12/17/24`, conventional simply-supported multi-column) to 0.80/1.00/1.20/1.70 (`HWB3/4/28`) | material, continuity, span count, max span length, bent type, design era; plus span count and skew angle for the manual's modification factors |
| Dams | none | HAZUS models dams as inventory only; it has no dam fragility | none |

(SimCenter labels `EP.S.M.U` as "Low Voltage" in its description, which
is a typo; the id and the values are the medium-voltage row.)

**Whether each category can use HAZUS:**

- **Substations: yes.** Voltage comes from BTN lines, and the sample
  above shows it's derivable. Anchorage isn't recorded anywhere, so we
  use the unanchored ("standard") curves, the conservative choice. BTN's
  voltage classes map onto HAZUS's as follows: <100 and 100–150 kV →
  Low, 220 kV → Medium, 400 kV → High. HAZUS's classes are defined
  around US 115/230/500 kV practice; confirm the exact boundaries
  against the manual. Unknown voltage falls back to Medium.
  *Check on the full data:* the share of substations that get a voltage.
  If it's well below ~80%, report the fallback share in the UI's
  "about these estimates" note.
- **Thermal, combined-cycle and hydro plants: yes, with a default.** BTN
  has no capacity, so every plant gets `EP.G.ML.U` until a capacity
  source is joined. MITECO's register of electricity generation plants
  (RAIPRE) is the candidate. It's flagged low-confidence in the UI.
- **PV, wind and solar-thermal plants: no.** HAZUS generation curves
  describe plant equipment and buildings, not panel fields or turbine
  arrays. These get intensity only.
- **Nuclear plants: no, on purpose.** They're designed to site-specific
  seismic criteria under nuclear-safety regulation, not generic
  fragility. Intensity only, labelled as such.
- **Bridges: not now.** HAZUS bridge classes depend on attributes BTN
  doesn't have: in the sample, only type, status and road segment. The
  medians across plausible default classes differ by about 3x (0.25 g vs
  0.80 g at Slight), so the default we picked would drive the answer.
  Spain's first bridge-specific seismic code is NCSP-07 (2007), so most
  of the stock would be "conventional" design. That narrows the era
  choice but not material, continuity or span count. Bridges get
  intensity only. Revisit if a bridge inventory with structural
  attributes can be obtained: the Ministry of Transport manages one for
  State roads, and the UPM collaboration is the route to ask.
- **Dams: no fragility, but show `ID_PRESA`.** HAZUS itself has no dam
  fragility. Joining the IPE id lets the popup show the dam's official
  risk category (A/B/C) once IPE is ingested. That's more useful to an
  emergency planner than a generic curve.
- **Facilities in buildings (hospitals, schools, …): our own model, not
  HAZUS.** They take the damage state their Catastro building already
  gets from our Martins & Silva fragility (ADR-0012), so a hospital and
  the housing next door are judged on the same basis.

HAZUS lifeline damage runs in the scenario service. It reuses the
fragility machinery `damage.py` already has for lognormal curves: new
rows in the fragility parquet keyed by `hazus_class`, no new code path.
Each affected asset reports its intensity, plus a damage state and
per-state probabilities where a model exists. `API_VERSION` is bumped.

### Frontend

- **Panel:** a "Critical infrastructure" panel next to the legend,
  collapsed by default. It has a master toggle and one toggle per
  category: Health, Care homes, Education, Emergency services, Power,
  Bridges, Dams, and later Water and Transport. Toggle state is kept
  per viewer.
- **Before a run:** assets show as neutral icons, and polygons (plants,
  substations) as outlines, from `infrastructure.pmtiles`.
- **After a run:** affected assets (intensity ≥ VI) are colored by
  their **intensity band**, the same palette as the bands layer, for
  every category. That gives one visual language whether or not an asset
  has a damage model. Assets below VI fade back to the neutral style.
  Where a damage estimate exists (substations, conventional plants,
  facility buildings), the popup and sidebar show the damage state and
  its probabilities next to the intensity. Facility buildings also keep
  their damage color on the building layer at building zoom.
- **Bands layer:** its own toggle in the legend area, independent of the
  infrastructure panel, with its own legend rows (IV … X).
- **Sidebar:** each affected municipality gets a "Critical
  infrastructure" list of affected assets: category icon, name,
  intensity, and damage state where modelled.

## Alternatives considered

- **Catastro's alphanumeric bulk files for facility use.** They'd give
  finer use codes on the buildings we already have, but they need a
  registered download, and use codes don't say "this is *the* hospital"
  the way BTN's CNH/RCD ids do. Not needed while BTN covers it.
- **Catastro-only facility detection** (`4_3_publicServices` →
  "critical"). Too coarse: it mixes libraries, sports halls and
  cemeteries with hospitals.
- **Geocoding the CNH/RCD registries ourselves.** BTN already carries
  their ids on located points, so that work is done.
- **OpenStreetMap.** Good coverage, but not an official source, and the
  requirement was official data first. It stays a fallback for gaps (for
  example substation voltage), never the base layer.
- **"Affected" = inside the evaluated radius.** Rejected: the radius is
  a search bound and overstates impact (see Context).
- **A single default HAZUS bridge class.** Rejected for now: the chosen
  class, not the earthquake, would dominate the result (about 3x spread
  in medians).
- **SYNER-G (EU FP7) fragility functions** instead of HAZUS for lifelines.
  They're European-calibrated and cover bridges, substations and water
  systems, so they're worth comparing against HAZUS once the substation
  path works. Not adopted yet because the HAZUS tables were available in
  machine-readable form and SYNER-G's weren't checked here.

## Consequences

- **Setup:** a new manual setup step (BTN download) in the README
  quickstart and in `DATA-SOURCES.md`, with the CNIG page link and file
  names.
- **Scenario service:**
  - a static asset table loaded once per process, like `AreaMeta`;
  - a gridded intensity pass per scenario;
  - a new stored artifact (`intensity.geojson.gz`) and route;
  - Lambda memory and warm-cache timings to be re-measured after, as in
    ADR-0020/0023.
- **Deploy:** `DATA_VERSION` and `API_VERSION` bumps and a cache re-warm
  when this ships.
- **Follow-ups:**
  - RAIPRE capacity for power plants;
  - IPE risk category for dams;
  - a structural bridge inventory (via UPM);
  - phase-2 water and transport assets;
  - a HAZUS-vs-SYNER-G comparison for substations.
