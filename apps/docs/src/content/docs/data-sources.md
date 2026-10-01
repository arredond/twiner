---
title: Data sources
description: Every dataset TWIN-ER uses, who publishes it, and the exact resource it is read from.
---

Every input is published by a public body or research consortium. Each
entry links to the resource TWIN-ER actually reads: a download feed, a web
service or a file, not just the publisher's home page. Most are processed
once, offline, by TWIN-ER's pipelines. The real-time layers are fetched live.

Where a licence is stated, it is the one the publisher declares. Otherwise
the data is published under the publisher's own open-reuse terms, which
require attribution.

## Buildings (exposure)

| Dataset | Publisher | Coverage | Resource |
|---|---|---|---|
| Cadastral buildings (INSPIRE Buildings) | Dirección General del Catastro | All of Spain except the Basque Country and Navarra | [ATOM feed](https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.bu.atom.xml) |
| Cadastral buildings (INSPIRE) | Diputación Foral de Álava | Álava | [ATOM feed](https://geo.araba.eus/atom/BU/Buildings.atom) |
| Cadastral buildings | Diputación Foral de Gipuzkoa | Gipuzkoa | [ATOM download](https://b5m.gipuzkoa.eus/inspire/download/buildings.xml) |
| Cadastral buildings (WFS) | Diputación Foral de Bizkaia | Bizkaia | [WFS](https://geo.bizkaia.eus/arcgisserverinspire/services/LurraldeAntolamendua_PlanificacionTerritorial/Katastro_Catastro_WFS/MapServer/WFSServer) |
| Cadastral buildings (INSPIRE WFS) | Gobierno de Navarra (IDENA) | Navarra | [WFS](https://inspire.navarra.es/services/BU/wfs) |

Each building's footprint, floors, construction year, use, dwellings and
floor area. The Basque Country and Navarra run their own (Foral) cadastres,
so they come from four separate services.

## Boundaries and population

| Dataset | Publisher | Coverage | Licence | Resource |
|---|---|---|---|---|
| Municipal boundaries (*Líneas límite*) | Instituto Geográfico Nacional (IGN/CNIG) | All of Spain: municipalities, provinces, autonomous communities | CC BY 4.0 | [ATOM feed](https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml) |
| Census section boundaries, 1 January 2025 | Instituto Nacional de Estadística (INE) | All of Spain, 36,554 sections | | [Download](https://www.ine.es/prodyser/cartografia/seccionado_2025.zip) |
| *Censo Anual de Población*: population by sex and five-year age group, per census section | INE | All of Spain, one table per province | | [Results index](https://www.ine.es/dynt3/inebase/es/index.htm?padre=11555&capsel=11154) |

## Earthquakes

| Dataset | Publisher | Coverage | Licence | Resource |
|---|---|---|---|---|
| QAFI v4: Quaternary Active Faults Database of Iberia | Instituto Geológico y Minero de España (IGME-CSIC) | 201 active faults in Spain | CC BY-SA 4.0 | [Fault traces](https://info.igme.es/qafi/docs/QAFI_Traces.rar) |
| ESRM20 site model ($V_{S30}$, 30 arc-seconds) | EFEHR / ETH Zürich, European Seismic Risk Model 2020 | Spain, except the Canary Islands | CC BY 4.0 | [Repository](https://gitlab.seismo.ethz.ch/efehr/esrm20) |
| Global fragility functions (Martins & Silva 2021) | GEM Foundation authors | 3 building classes, 1–12 storeys | Free use with citation | [Repository](https://github.com/lmartins88/global_fragility_vulnerability) |

The ground-motion model, Akkar et al. (2014), comes from the OpenQuake
`hazardlib` library (GEM Foundation, AGPL-3.0).

## Floods

| Dataset | Publisher | Coverage | Resource |
|---|---|---|---|
| Flood zones by return period (*Zonas inundables asociadas a periodos de retorno*), 2nd cycle | Ministerio para la Transición Ecológica (MITECO), SNCZI | Studied river stretches. Peninsula and Balearic Islands at T = 10, 50, 100 and 500 years; Canary Islands at T = 100 and 500 | [Download page](https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html) |

## Critical infrastructure

| Dataset | Publisher | Coverage | Licence | Resource |
|---|---|---|---|---|
| Base Topográfica Nacional (BTN): services and facilities, energy, and constructions themes | IGN/CNIG | All of Spain | CC BY 4.0 | [Download page](https://centrodedescargas.cnig.es/CentroDescargas/btn) |

From the BTN, TWIN-ER takes:

- schools and universities;
- hospitals and health centres;
- care homes;
- police and emergency services;
- power plants and substations;
- bridges;
- dams, keeping only those in MITECO's dam inventory. The BTN also maps
  ponds and irrigation embankments as dams.

Hospitals, schools and dams carry their national registry ids.

## Real-time layers

These are fetched live by the API when the map asks for them, not stored.

| Dataset | Publisher | Coverage | Resource |
|---|---|---|---|
| Traffic incidents (DATEX II v3.7) | Dirección General de Tráfico (DGT), National Access Point | Spain except the Basque Country and most of Catalonia | [Feed](https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml) |
| Traffic incidents (DATEX II) | Servei Català de Trànsit (SCT) | Catalonia | [Feed](https://nap.dgt.es/datex2/sct/SituationPublication/all/content.xml) |
| Traffic incidents (DATEX II) | Dirección de Tráfico del Gobierno Vasco (Trafikoa) | Basque Country | [Feed](https://nap.dgt.es/datex2/dt-gv/SituationPublication/all/content.xml) |
| Conventional weather observations | Agencia Estatal de Meteorología (AEMET), OpenData | About 850 automatic stations, latest 24 hours | [API](https://opendata.aemet.es/centrodedescargas/inicio) (free key) |
| Meteoalerta weather warnings (CAP 1.2) | AEMET, OpenData | All of Spain, by warning zone, up to two days ahead | [API](https://opendata.aemet.es/centrodedescargas/inicio) (free key) |

Some regional incident records give only a road and kilometre point, with
no coordinates. Those are not shown yet.

## Basemap

| Dataset | Publisher | Licence | Resource |
|---|---|---|---|
| OpenStreetMap vector tiles (daily build), extract covering Spain | Protomaps; data © OpenStreetMap contributors | ODbL | [Builds](https://maps.protomaps.com/builds/) |
| Basemap fonts and sprites | Protomaps (Noto Sans fonts) | OFL | [basemaps-assets](https://github.com/protomaps/basemaps-assets) |

The basemap is self-hosted as a single PMTiles file, so the app depends on
no third-party map service at runtime.
