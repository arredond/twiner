---
title: twinFLOOD
description: How TWIN-ER estimates river-flood exposure from MITECO's official flood zones.
---

twinFLOOD shows which buildings, people and critical infrastructure lie in
the **official river flood zones** for a chosen return period and area. It
then reports them per census section and municipality, in the same units as
an earthquake scenario.

Unlike [twinQUAKE](/docs/hazards/earthquake/), twinFLOOD doesn't run a
physical model of its own. Spain already has an authoritative,
nationally consistent set of flood maps, produced by hydrological and
hydraulic modelling. TWIN-ER's job is to cross those maps with the building
stock and the census, building by building, for the whole country.

## The flood maps: SNCZI

Under the EU Floods Directive (2007/60/EC) [1], transposed into Spanish law
by Royal Decree 903/2010 [2], Spain maps the areas that rivers flood at
given probabilities. The maps are produced by the Ministry for the
Ecological Transition (MITECO) and the river basin authorities, and
published in the **National Flood Zone Mapping System (SNCZI)** [3].

The flood extents come from:

- hydrological studies of design discharges;
- hydraulic models of how that water spreads over the terrain, run on a
  high-resolution LiDAR elevation model (2 m grid).

TWIN-ER uses the second planning cycle's flood extents for four return
periods: 10, 50, 100 and 500 years.

### Return periods

A **return period** $T$ is the average interval between floods at least
that large. Its annual exceedance probability is $p = 1/T$. The probability
of at least one such flood in $N$ years is:

$$
P(\text{at least one in } N \text{ years}) = 1 - \left(1 - \frac{1}{T}\right)^{N}
$$

| Return period | Annual probability | In 30 years | In 100 years | SNCZI category |
|---|---|---|---|---|
| T = 10 years | 10% | 96% | ≈100% | High probability |
| T = 50 years | 2% | 45% | 87% | Frequent |
| T = 100 years | 1% | 26% | 63% | Medium probability (occasional) |
| T = 500 years | 0.2% | 6% | 18% | Low probability (exceptional) |

A "100-year flood" is therefore far from a once-in-a-lifetime event: there
is about a one-in-four chance of one in any 30-year period.

### What the maps cover

Flood zones are only mapped along the river stretches MITECO has studied:
mainly the areas of potential significant flood risk (ARPSIs) identified
in the preliminary flood risk assessment. That is roughly a third of
Spain's main rivers, depending on the return period. In addition:

- the maps cover **river (fluvial) flooding** only;
- Canarias is mapped for T = 100 and T = 500 only. There are no T = 10 or
  T = 50 maps for the islands.

## Method

### 1. Preparing the flood zones (offline)

The flood extents are detailed polygons traced from the 2 m terrain model;
the T = 10 layer alone has about 94 million vertices. TWIN-ER processes
them once, offline:

1. **Repair.** Invalid polygons, about 13% of them, are repaired.
2. **Simplify.** Polygons are simplified with a 1 m Douglas–Peucker
   tolerance. That is half the terrain grid and far below the maps' 1:25,000
   publication scale, and it keeps about 15% of the vertices.
3. **Cut by census section.** The zones are cut along INE census-section
   boundaries and merged per section and return period. Merging removes
   overlaps between studies of the same river stretch, which would
   otherwise count area twice. Because each section nests in exactly one
   municipality, province and autonomous community, flooded area can then
   be summed exactly at every level.

### 2. Buildings in the flood zone (offline)

A building is **in the flood zone** at return period $T$ when its
**footprint** intersects the zone at $T$. The test uses the footprint, not
only the centroid: a long building on a riverbank can have its centroid on
dry ground and a wall in the water. Critical infrastructure assets get the
same test on their own geometry.

Membership in a flood zone doesn't depend on the scenario, so it is
computed once for all ~13 million buildings and all four return periods.
About 660,000 buildings fall in a mapped flood zone at some return period.

### 3. A scenario: return period × area (per request)

A scenario is a return period plus an area:

- a **circle** of up to 200 km radius, drawn on the map; or
- an **administrative area**: an autonomous community, province or
  municipality, picked on the map or searched by name.

TWIN-ER selects the precomputed flooded buildings in that area and sums
them per census section and municipality. Even a large area takes a
fraction of a second, because nothing is recomputed geometrically except
the zones cut by a circle's edge.

Provinces with no map for the chosen return period are reported as
**unmapped**, not as unflooded.

## Outputs

For each census section and municipality:

- buildings in the flood zone, also as a % of the area's buildings;
- dwellings in the flood zone;
- residents in the flood zone, and how many are vulnerable (under 15 or 65
  and over);
- flooded area, in km².

Hospitals, schools, care homes, emergency services, power facilities,
bridges and dams inside the zone are listed separately.
[Impact estimates](/docs/impact-estimates/#flood-figures) gives the
formulas.

## Limitations

- **Mapped is not the same as at risk.** Outside the studied river
  stretches, "no buildings flooded" means "no map", not "no risk".
- **River flooding only.** Flash floods from intense local rainfall,
  coastal and storm-surge flooding, and urban drainage overflow are not
  included.
- **Extent, not depth.** Without water depths or velocities there are no
  depth–damage curves. twinFLOOD reports exposure (what lies in the zone),
  not damage, cost or debris.
- **Static maps.** The zones reflect the terrain, river works and climate
  assumed when they were modelled. They don't account for later changes or
  for climate-change scenarios.
- **Night-time population.** As for earthquakes, residents are placed by
  dwelling, not by where people are during the day.

## References

1. European Parliament and Council (2007). Directive 2007/60/EC of 23
   October 2007 on the assessment and management of flood risks. *Official
   Journal of the European Union*, L 288, 27–34.
   [eur-lex.europa.eu](https://eur-lex.europa.eu/eli/dir/2007/60/oj)
2. Real Decreto 903/2010, de 9 de julio, de evaluación y gestión de
   riesgos de inundación. *Boletín Oficial del Estado*, 171, 15 July 2010.
   [boe.es](https://www.boe.es/eli/es/rd/2010/07/09/903)
3. MITECO. *Sistema Nacional de Cartografía de Zonas Inundables (SNCZI)*.
   Ministerio para la Transición Ecológica y el Reto Demográfico.
   [miteco.gob.es](https://www.miteco.gob.es/es/agua/temas/gestion-de-los-riesgos-de-inundacion/snczi.html)
