---
title: twinCOAST
description: How TWIN-ER estimates coastal-flood exposure from MITECO's official coastal flood zones.
---

twinCOAST shows which buildings, people and critical infrastructure lie in
the **official coastal flood zones** for a chosen return period and area:
the land the sea reaches in a storm. It reports them per census section and
municipality, exactly like [twinFLOOD](/docs/hazards/flood/) does for
rivers.

The method is twinFLOOD's, applied to a different set of maps. This page
covers what is different; [twinFLOOD](/docs/hazards/flood/) describes the
shared method in full.

## The coastal flood maps

The EU Floods Directive (2007/60/EC) [1] covers flooding from the sea as
well as from rivers. Under Royal Decree 903/2010 [2], the Ministry for the
Ecological Transition (MITECO) mapped the **areas of potential significant
flood risk (ARPSIs) on the coast** and published their flood extents in
the National Flood Zone Mapping System (SNCZI) [3], as "flood zones of
marine origin".

The extents come from the 2014 coastal studies:

- sea level and wave conditions from about 60 years of hindcast data;
- wave run-up computed on profiles every 200 m along the coast;
- the resulting flood level projected onto a 5 m terrain model.

### Return periods

Coastal maps exist for **two** return periods only:

| Return period | Annual probability | In 30 years | SNCZI category |
|---|---|---|---|
| T = 100 years | 1% | 26% | Medium probability (occasional) |
| T = 500 years | 0.2% | 6% | Low probability (exceptional) |

See [twinFLOOD](/docs/hazards/flood/#return-periods) for what a return
period means.

### What the maps cover

- **Studied coast only.** Zones are mapped on the 397 stretches of coast
  identified as ARPSIs: about 2,000 km² of land at either return period,
  in 386 municipalities.
- **All of Spain's coast, islands included.** The Canary and Balearic
  Islands, Ceuta and Melilla are mapped at both return periods, so, unlike
  river flooding, nothing is "not mapped".
- **Estuaries.** The sea reaches up river mouths, so some inland
  municipalities have coastal flood zones: Sevilla, on the Guadalquivir
  estuary, is the clearest case.

## Method

Exactly as in [twinFLOOD](/docs/hazards/flood/#method):

1. The zones are repaired, simplified with a 1 m tolerance, cut by census
   section and merged per section and return period. The coastal files
   come in geographic coordinates, so they are first projected to an
   equal-area grid in metres, so the 1 m tolerance is still 1 m.
2. A building is in the zone when its **footprint** intersects it.
   Critical infrastructure gets the same test.
3. A scenario is a return period plus an area: a circle of up to 200 km,
   or an autonomous community, province or municipality.

Zone area that falls outside every census section, mostly at sea, is left
out (about 185 km² at each return period).

### Only areas with a coastal zone

The area picker and the search box only offer the autonomous communities,
provinces and municipalities that have a coastal flood zone. The list comes
from the processed maps themselves, not from a list of coastal provinces:
a municipality is listed when a zone covers at least 1,000 m² of it, or
when any of its buildings is in a zone. That keeps estuary municipalities
in, and leaves out coastal ones with no studied stretch. The 1,000 m²
threshold drops slivers where a zone only grazes a neighbouring
municipality's boundary.

## Results

From the national run:

| Return period | Municipalities | Zone area (km²) | Buildings in zone |
|---|---|---|---|
| T = 100 | 385 | 2,025 | 43,288 |
| T = 500 | 386 | 2,080 | 48,949 |

The provinces with most buildings in the T = 500 zone are Las Palmas,
Sevilla, Santa Cruz de Tenerife, Cádiz and Málaga. Most of the critical
infrastructure in the zone is bridges, followed by schools and power
facilities.

## Outputs

The same as twinFLOOD's: buildings, dwellings, residents and vulnerable
residents in the zone, and flooded area, per census section and
municipality, plus the critical infrastructure inside the zone. See
[impact estimates](/docs/impact-estimates/#flood-figures).

## Limitations

All of [twinFLOOD's](/docs/hazards/flood/#limitations) apply, plus:

- **Studied coast only.** Outside the mapped stretches, "no buildings in
  the zone" means "no map", not "no risk".
- **2014 studies, present-day sea level.** The maps include no
  sea-level-rise scenarios and don't reflect later changes to the coast.
- **Extent, not depth.** MITECO also publishes coastal water depths, which
  would allow depth–damage curves. They're not used yet.

## References

1. European Parliament and Council (2007). Directive 2007/60/EC of 23
   October 2007 on the assessment and management of flood risks. *Official
   Journal of the European Union*, L 288, 27–34.
   [eur-lex.europa.eu](https://eur-lex.europa.eu/eli/dir/2007/60/oj)
2. Real Decreto 903/2010, de 9 de julio, de evaluación y gestión de
   riesgos de inundación. *Boletín Oficial del Estado*, 171, 15 July 2010.
   [boe.es](https://www.boe.es/eli/es/rd/2010/07/09/903)
3. MITECO. *Zonas inundables de origen marino*. Sistema Nacional de
   Cartografía de Zonas Inundables (SNCZI).
   [miteco.gob.es](https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/costas-medio-marino/zi-origen-marino.html)
