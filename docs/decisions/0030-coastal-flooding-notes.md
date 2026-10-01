# ADR-0030: Coastal flooding: not now, and how it would fit

Status: proposed (notes for a future hazard; nothing built)

## Context

ADR-0029 added fluvial flood scenarios from MITECO's SNCZI flood zones. The
same national system also maps **coastal** flooding ("zonas inundables de
origen marino"): how far the sea reaches in a storm surge at a given
return period. We decided to leave it out of the first flood mode, but it
is the most likely next hazard. This ADR records what exists and how much
of ADR-0029 it could reuse, so the next person doesn't redo the research.

## What exists (checked 2026-09-30)

From MITECO's Atom catalogue
(<https://gis.miteco.gob.es/descargas/atom/catalog.atom>):

- **"Extensión de la inundación costera" T=100 and T=500**: vector flood
  extents, the direct coastal counterpart of the fluvial zones. There are
  only **two return periods** (no T=10/T=50). Their dataset feeds
  (`…/dataset/b42355e9-….atom` and `…/8c13dce4-….atom`, readable through
  `gis.miteco.gob.es/descargas/atom/dataset/<id>.atom`) name one file per
  period, "Península Ibérica e Islas Baleares - EPSG:4258":
  `laminas-q100.zip` / `laminas-q500.zip`. The link they give (the legacy
  `mapama.gob.es/app/descargas/descargafichero.aspx`) is dead (404). The same
  names do exist behind the current `gis.miteco.gob.es` captcha endpoint,
  like the fluvial files. The download page is
  <https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/costas-medio-marino/zi-origen-marino.html>.
  Not checked: whether Canarias has coastal files (the fluvial ones are
  split Península+Baleares / Canarias, so look for the same split there).
  - Caution: the fluvial page links T=50 as `laminas-q50.zip`, a name with
    the same pattern. `laminas-q10.zip` and `laminas-q50.zip` also exist
    behind the captcha. Open the files and check their `TIPO_ZONA`
    attribute before trusting that `laminas-q100/q500` are coastal.
- **"Peligrosidad por inundación costera" T=100/T=500**: water **depth**
  rasters. CNIG distributes them as ESRI ASCII grids in five partitions per
  period, ~0.4-1.2GB each
  (<https://centrodedescargas.cnig.es/CentroDescargas/mapas-peligrosidad-inundacion-costera>).
  CNIG blocks scripted downloads (ADR-0025), so this would be a manual
  download too.
- **Risk layers** ("Mapa de riesgo inundación costera afección población /
  económica / ambiental", T=100/T=500) and their WMS services. These are
  MITECO's own exposure overlays, not needed: we compute exposure ourselves.
- WMS: `https://wms.mapama.gob.es/sig/Costas/ZI_LaminasQ100` / `Q500`.
  Raster only, like the fluvial WMS.

## How it would fit

Almost everything in ADR-0029 is hazard-agnostic "polygon zone per return
period → flagged buildings":

- **Pipeline**: `pipelines/flood` could take the coastal zips as another
  `SourceFile` family with `hazard="coastal"`. `zones.py` (repair,
  simplify, cut by census section, merge) and `exposure.py` (footprint
  intersection, per-province workers, NULL for unmapped periods) need no
  changes beyond a hazard key in their output columns or file names.
- **Outputs**: either extra columns (`coastal_t100`, `coastal_t500`) in
  `building_flood.parquet`, or a sibling `building_coastal.parquet`. A
  sibling file is simpler while the two hazards stay separate in the UI;
  columns are better if we ever want "fluvial **or** coastal at T=100"
  (the EU Floods Directive reports them combined).
- **Backend**: `scenario/flood.py`'s selection and aggregation already
  take a return period and a region. A `source` parameter
  (fluvial/coastal/combined) would choose which flag column to read.
- **Frontend**: a third hazard, or a "fluvial / coastal / both" toggle
  inside flood mode. Return periods would be limited to T100/T500 for
  coastal.

## What would be new

- Only two return periods, and the page's own caveat about which stretches
  of coast have been studied.
- **Depth**: the coastal hazard maps come with depth rasters. That opens the
  door to depth-damage curves (like JRC's Huizinga et al. 2017 functions for
  Europe), i.e. an actual loss estimate rather than "in the zone / not in
  the zone". The same holds for fluvial depth (CNIG MPIF2, T=10/100/500).
  It would be worth deciding on depth handling for both at once.
- Sea-level-rise scenarios exist in some of MITECO's coastal studies. They
  are out of scope for a return-period model.

## Decision

Nothing built now. Add coastal flooding as its own step once fluvial flood
mode has settled, reusing ADR-0029's pipeline and endpoint as described
above.
