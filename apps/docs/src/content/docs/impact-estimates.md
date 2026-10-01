---
title: Impact estimates
description: How TWIN-ER turns building damage or flood exposure into figures per census section and municipality.
---

After a scenario runs, TWIN-ER reports a set of impact figures for every
affected census section and municipality. This page explains how each one
is computed.

:::caution[Rough, documented estimates]
These are **orders of magnitude for comparing places and scenarios, not a
calibrated loss model**. Every parameter below is either a round-number
assumption or a generic default from the US HAZUS methodology [1], mapped
onto TWIN-ER's building classes. None has yet been validated against
observed Spanish losses.
:::

## Inputs

For every building it evaluates, an earthquake scenario knows the reported
damage state: None, Slight, Moderate, Extensive or Complete (see
[twinQUAKE](/docs/hazards/earthquake/)). Three more attributes of each
building come from the exposure model:

| Attribute | Source |
|---|---|
| Census section | The INE 2025 census section containing the building's centroid, or the nearest section in its own municipality if none does. |
| Dwellings | Cadastral number of dwellings. |
| Built area | Cadastral gross floor area over all storeys. The Foral cadastres don't publish it, so in the Basque Country and Navarra it is the footprint area × the number of storeys. |

INE's *Censo Anual de Población* (1 January 2025) gives three figures for
each census section [2]:

- the resident population;
- residents under 15;
- residents aged 65 and over.

As a scenario runs, TWIN-ER sums buildings, dwellings and built area per
census section and damage state. Every figure below is derived from those
sums. A municipality's figures are the sums of its sections'. Percentages
are recomputed from the sums, never averaged.

**Definitions.** A building is **affected** when its damage state is
anything other than None. Its residents are **displaced** when the state is
Extensive or Complete.

## Earthquake figures

### Buildings affected

The number of affected buildings, and that number as a percentage of
**all** the area's buildings (not only the ones the scenario evaluated).

### Affected population

INE publishes how many people live in a section, not in which building.
TWIN-ER spreads each section's residents over its buildings **in proportion
to their dwellings**:

$$
\text{Affected population}_s = \text{Population}_s \times
\frac{\text{dwellings in affected buildings}_s}{\text{all dwellings}_s}
$$

The **displaced** population uses dwellings in Extensive and Complete
buildings instead.

Every resident is spread across every cadastral dwelling, including second
homes and empty ones. Nationally that averages 1.92 residents per cadastral
dwelling (49.1 million residents, 25.6 million dwellings), below the
roughly 2.5 people per occupied household. In coastal and rural sections
with many second homes, the population is therefore spread more thinly
than it really is.

A few populated sections have no dwellings recorded on any building. There,
residents are spread by building count instead.

### Vulnerable population affected

The **vulnerable** (dependent) population is residents under 15 or aged 65
and over. These are the dependent age groups of Eurostat's age-dependency
ratio; INE's own ratio uses under 16, which the census's five-year age
groups can't express.

$$
\text{Affected vulnerable}_s = \text{Affected population}_s \times
\frac{\text{under-15}_s + \text{65 and over}_s}{\text{Population}_s}
$$

This assumes each section's age structure applies to all its buildings.

### Material cost

$$
\text{Cost} = \sum_{ds} A_{ds} \times c \times r_{ds}
$$

where:

- $A_{ds}$ is the built area in damage state $ds$;
- $c$ = €1,000/m² is the replacement cost;
- $r_{ds}$ is the damage ratio (repair cost ÷ replacement cost).

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Damage ratio $r_{ds}$ | 2% | 10% | 43% | 100% |

- **Damage ratios.** HAZUS-MH 2.1, Tables 15.2–15.4 [1]: the structural
  ratios plus the acceleration- and drift-sensitive non-structural ones,
  for residential buildings. The Extensive ratio is the average of
  single-family (44.7%) and multi-family (41.3%) housing.
- **Replacement cost.** €1,000/m² is a round-number assumption for
  demolishing and rebuilding an average Spanish building, not a published
  Spanish reference. Construction costs vary widely by region and type, so
  this is the parameter most worth replacing.
- **Excluded:** building contents, indirect losses, and post-disaster
  increases in construction costs.

### Debris

$$
\text{Debris (t)} = \sum_{ds} A_{ds} \times w \times f_{ds}
$$

where $w$ = 1.1 t/m² is the building weight per unit of floor area and
$f_{ds}$ is the share of that weight that becomes debris:

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Debris fraction $f_{ds}$ | 2% | 10% | 38% | 100% |

Both come from HAZUS-MH 2.1, Tables 12.1–12.3 [1]. The values sit between
the HAZUS concrete-frame-with-masonry-infill type (C3: 1.17 t/m²) and the
unreinforced-masonry types (URM: 0.88 t/m²), rounded. HAZUS units (short
tons per 1,000 ft²) are converted to tonnes per m².

This is a weight estimate. It is separate from the **debris envelopes** on
the map, which show where debris could fall, not how much there is.

### Truck rotations

$$
\text{Truck rotations} = \left\lceil \frac{\text{Debris (t)}}{20\ \text{t}} \right\rceil
$$

20 t is a typical payload for a 3–4-axle rigid dump truck. The figure
counts trips only. It ignores volume limits (bulky rubble can fill a truck
before its weight limit), haul distance and sorting.

### Shoring props

$$
\text{Props} = \sum_{ds} A_{ds} \times s_{ds} \times 1\ \text{prop/m}^2
$$

where $s_{ds}$ is the share of built area that needs emergency shoring:

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Share needing shoring $s_{ds}$ | 0% | 5% | 20% | 0% |

These shares are **pure assumptions**, with no published source.
Emergency slab shoring typically places props about 1 m apart. Moderate
damage may need local propping, Extensive damage more. Completely damaged
buildings are demolished rather than shored.

## Flood figures

A flood scenario has no damage states: a building is either in the flood
zone at the chosen return period or not. So the damage-based figures above
(cost, debris, trucks, shoring, displaced residents) don't apply. They
would need water depths and depth–damage curves, which the official flood
maps don't provide. For each census section, rolled up to municipalities:

| Figure | How it's computed |
|---|---|
| Buildings in the flood zone | Buildings whose footprint intersects the zone; also as a % of all the section's buildings. |
| Dwellings in the flood zone | Sum of those buildings' dwellings. |
| Residents in the flood zone | Section population × dwellings in the zone ÷ all section dwellings, as above. |
| Vulnerable residents | Residents in the zone × the section's under-15 and 65-and-over share. |
| Flooded area | Area of the flood zone inside the section, and inside the circle if one was drawn, in km². |

"Not mapped" is not "not flooded". See [twinFLOOD](/docs/hazards/flood/)
for what the flood maps cover.

## Limitations

- **One cost and one weight per m² for every building.** Industrial sheds
  weigh and cost far less per m² than housing. Splitting by class and use
  is the obvious next refinement.
- **Night-time population only.** There is no daytime or occupancy model.
- **No uncertainty bands.** Every figure uses the damage state reported at
  the chosen probability level, not the full damage distribution.

## References

1. FEMA (2012). *Multi-hazard Loss Estimation Methodology, Earthquake
   Model: Hazus-MH 2.1 Technical Manual*. Federal Emergency Management
   Agency, Washington, DC.
2. INE. *Censo Anual de Población 2021–2025*. Instituto Nacional de
   Estadística. [ine.es](https://www.ine.es/)
