---
title: twinQUAKE
description: How TWIN-ER simulates an earthquake scenario, from the fault rupture to the damage state of every building.
---

twinQUAKE simulates a **deterministic earthquake scenario**: one specific
earthquake, on one fault or at one location you define. It estimates the
damage that earthquake would cause to every building within reach, then
aggregates the results into impact figures per census section and
municipality.

It follows the standard chain of scenario-based seismic risk assessment, as
implemented in MERISUR [1] and in tools such as the OpenQuake Engine [2]:

1. **Source.** Where the earthquake ruptures, how large it is, and with
   what mechanism.
2. **Ground motion.** How strongly the ground shakes at each building, as
   predicted by a ground-motion model.
3. **Site amplification.** How the local soil amplifies that shaking.
4. **Probability level.** Which part of the uncertainty range to report.
5. **Exposure and vulnerability.** Which structural class each building
   belongs to.
6. **Fragility and damage.** The probability that each building reaches
   each damage state at its shaking.
7. **Impact.** What those damage states mean for people, cost, debris and
   critical infrastructure.

A typical scenario evaluates hundreds of thousands to a few million
buildings in a few seconds.

## 1. Source: the earthquake rupture

There are two ways to define the earthquake.

### Automatic mode: an active fault's maximum earthquake

You pick a fault from the **Quaternary Active Faults Database of Iberia
(QAFI v4)**, compiled by the Spanish Geological Survey (IGME) [3]. It lists
201 active faults in Spain, each with a mapped surface trace, dip, rake
(slip direction) and seismogenic depth range. TWIN-ER simulates the fault's
**maximum earthquake**: the largest magnitude the fault is considered
capable of.

- **Magnitude.** 120 of the 201 faults have a maximum magnitude published
  in the literature and recorded in QAFI. For the other 81, it is estimated
  from the length of the mapped trace with the Wells & Coppersmith (1994)
  relation for all fault types [4]:

  $$
  M_w = 5.08 + 1.16 \log_{10}(L)
  $$

  where $L$ is the surface rupture length in km. This treats the whole
  mapped trace as rupturing at once, so for a long fault that usually
  breaks in segments it overestimates the magnitude.
- **Geometry.** The rupture is a **finite plane**, not a point. It is built
  by projecting the fault trace down-dip, at the fault's dip angle, from the
  top to the bottom of its seismogenic depth range. The plane is
  discretised into a 2 km mesh with OpenQuake's `SimpleFaultSurface` [2].
  Distances are then measured to the nearest point of that plane, so
  shaking stays strong along the whole fault, not only near its midpoint.
- **Mechanism.** QAFI's rake, using the Aki & Richards convention: 0°
  strike-slip, 90° reverse, −90° normal.

### Manual mode: an earthquake you define

You click a location and set the magnitude. Optionally you can also set
the style of faulting (strike-slip, normal or reverse) or, for full
control, the strike, dip and depth to the top of the rupture.

- With only a location and magnitude, the rupture is a **point source**,
  and distances are measured to the epicentre.
- With strike, dip and depth, TWIN-ER builds a **finite plane** centred on
  the epicentre. Its length $L$ and down-dip width $W$ (km) come from Wells
  & Coppersmith (1994):

  $$
  \log_{10} L = \frac{M_w - 4.38}{1.49}, \qquad \log_{10} W = -1.01 + 0.32\,M_w
  $$

## 2. Ground motion

Ground shaking is predicted with the **Akkar, Sandıkkaya & Bommer (2014)**
ground-motion model (GMPE) [5]. It was derived from strong-motion records
of crustal earthquakes in Europe and the Middle East, and it is the model
MERISUR used. TWIN-ER evaluates it through OpenQuake's `hazardlib`
implementation [2] (`AkkarEtAlRjb2014`).

The model predicts the natural logarithm of an intensity measure $Y$ as a
reference-rock term plus a site term, with a lognormal scatter:

$$
\ln Y = \ln Y_{\text{ref}}(M_w, R_{JB}, \text{SoF}) + \ln S(V_{S30}, \text{PGA}_{\text{ref}}) + \varepsilon\,\sigma
$$

For magnitudes up to the hinge $c_1 = 6.75$, the reference term is

$$
\begin{aligned}
\ln Y_{\text{ref}} = {} & a_1 + a_2 (M_w - c_1) + a_3 (8.5 - M_w)^2 \\
& + \left[a_4 + a_5 (M_w - c_1)\right] \ln\sqrt{R_{JB}^2 + a_6^2} + a_8 F_N + a_9 F_R
\end{aligned}
$$

Above the hinge, $a_7$ replaces $a_2$. In these equations:

- $R_{JB}$ is the **Joyner–Boore distance**: the horizontal distance from
  the site to the surface projection of the rupture plane, or to the
  epicentre for a point source.
- $F_N$ and $F_R$ flag a normal or reverse mechanism. Strike-slip is the
  baseline.
- $a_1 \ldots a_9$ are period-dependent coefficients tabulated in [5].
- $\sigma$ is the model's total standard deviation, combining between- and
  within-event variability. It is about 0.7–0.8 in natural-log units for
  the intensity measures used here, so one standard deviation is roughly a
  factor of two in ground motion.

**Intensity measures.** Buildings of different heights respond to
different frequencies of shaking. Each building's fragility function
(step 6) is defined against the intensity measure that best predicts its
damage, so TWIN-ER computes all of the ones it needs:

| Intensity measure | Used for |
|---|---|
| Peak ground acceleration (PGA) | 1-storey concrete and rubble-stone buildings |
| Spectral acceleration SA(0.3 s) | 1–3-storey masonry (2–3 for rubble stone), 2–4-storey concrete |
| SA(0.6 s) | 4–5-storey masonry, 5–7-storey concrete |
| SA(1.0 s) | 8–12-storey concrete |
| Peak ground velocity (PGV) | Macroseismic intensity (step 7) |

**Evaluation grid.** The GMPE varies smoothly with distance. Ground motion
is therefore computed once per occupied 1 km grid cell rather than once per
building, which cuts the computation 40–50-fold. Checked against
per-building evaluation, the error is a mean of about 0.001 g and under 3%
at the 99th percentile, far below the model's own scatter.

**Search radius.** A scenario only evaluates buildings close enough to
matter. The radius is the distance at which SA(0.3 s), at the chosen
probability level, falls below 0.02 g. That is well under the lowest
intensity at which any fragility function in use predicts damage. The
radius is clamped between 10 and 300 km.

## 3. Site amplification

Soft soils amplify shaking: the 2011 Lorca earthquake did most of its
damage on the sediments of the Guadalentín valley. The Akkar et al. model
represents soil with $V_{S30}$, the average shear-wave velocity of the top
30 m, through a nonlinear site term from Sandıkkaya et al. (2013) [6]. It
amplifies weak shaking more than strong shaking:

$$
\ln S =
\begin{cases}
b_1 \ln\!\left(\dfrac{V_{S30}}{V_{\text{ref}}}\right)
+ b_2 \ln\!\left[\dfrac{\text{PGA}_{\text{ref}} + c\,(V_{S30}/V_{\text{ref}})^{n}}{(\text{PGA}_{\text{ref}} + c)\,(V_{S30}/V_{\text{ref}})^{n}}\right]
& V_{S30} < V_{\text{ref}} \\[2ex]
b_1 \ln\!\left(\dfrac{\min(V_{S30}, V_{\text{con}})}{V_{\text{ref}}}\right) & V_{S30} \ge V_{\text{ref}}
\end{cases}
$$

Here:

- $V_{\text{ref}} = 750$ m/s and $V_{\text{con}} = 1000$ m/s;
- $c = 2.5$ and $n = 3.2$;
- $\text{PGA}_{\text{ref}}$ is the PGA the model predicts on reference
  rock at the same site.

Each building's $V_{S30}$ comes from the site model of the **European
Seismic Risk Model 2020 (ESRM20)** [7, 8]. It is a grid at about 30
arc-seconds (≈ 800 m) inferred mainly from topographic slope and geology
[9], with measured values where they exist. In Lorca it gives 258–641 m/s
(median 388 m/s) across the town's buildings. That agrees with the EC8
site classes local geophysical surveys found in the most damaged districts.

The grid does not cover the Canary Islands. Buildings there, like any site
the grid doesn't reach, use $V_{S30} = 800$ m/s (rock, no amplification).

## 4. Probability levels

A GMPE predicts a distribution of ground motion, not a single value, and
fragility functions predict a distribution of damage. Like MERISUR, TWIN-ER
offers three **probability levels**. Each reads a different point of those
two distributions [1]:

| Level | Ground motion | Damage state shown per building |
|---|---|---|
| **High** probability | Median: $\varepsilon = 0$ | Most likely (modal) state |
| **Low** probability | Median + 1σ: $\varepsilon = 1$ | Most likely (modal) state |
| **Very low** probability | Median + 1σ: $\varepsilon = 1$ | 85th-percentile state |

The 85th-percentile state is the least severe state $ds$ whose cumulative
probability reaches 0.85:

$$
ds_{85} = \min\Big\{ ds : \sum_{d \le ds} P(DS = d) \ge 0.85 \Big\}
$$

So at most 15% of the probability mass is more severe than the reported
state. "Very low probability" therefore means a pessimistic but plausible
outcome, not a worst case.

The damage-state column applies to **individual buildings**: the single
state each building is coloured with on the map. Figures for **census
sections and municipalities** are instead expected values, which sum every
building's probability of each damage state (see [step 8](#8-impact)).
"Low" and "very low" share the same ground motion, so they give the same
area figures and differ only in the states shown building by building.

The levels matter a great deal. For the 2011 Lorca earthquake, median
ground motion falls well short of what was recorded near the fault. Median
+ 1σ comes within a few percent of the recorded peak ground acceleration
(see [validation](#validation-lorca-2011)).

## 5. Exposure and vulnerability classes

**Exposure** is the set of buildings at risk. TWIN-ER takes every building
from the Spanish cadastre: the Dirección General del Catastro's INSPIRE
service, plus the separate Foral cadastres of Álava, Gipuzkoa, Bizkaia and
Navarra. Each building record gives a footprint, a number of floors, a
construction year, its dwellings and its floor area. There are about 13
million buildings in all.

A building's **vulnerability class** is the structural typology that
determines how it responds to shaking. Field surveys are out of scope for a
national model, so TWIN-ER assigns the class from the two cadastral
attributes that carry structural information. Class names follow the GEM
building taxonomy [10]:

| Construction year | Class | Description |
|---|---|---|
| 1970 or later | `CR_LDUAL-DUL` | Reinforced concrete, dual frame–wall system, low ductility |
| 1940–1969 | `MUR_LWAL-DNO` | Unreinforced masonry, load-bearing walls, non-ductile |
| Before 1940, or unknown | `MUR-STRUB_LWAL-DNO` | Unreinforced rubble-stone masonry, load-bearing walls, non-ductile |

- **1970** roughly marks the generalisation of reinforced-concrete frames
  and of Spain's first seismic codes.
- **1940** separates older vernacular masonry, typically rubble stone like
  the historic centre of Lorca, from mid-century masonry.
- When the year is unknown, the building gets the **more vulnerable** class.

The **height class** is the number of floors, from 1 to 12. The masonry
classes only have fragility functions up to 5 storeys, so taller masonry
buildings use the 5-storey function.

The assignment is versioned (`heuristic_v2`) and stated with every
building, because it is an informed guess, not an observation. Catastro
doesn't record structural system, ductility or retrofitting. MERISUR, by
contrast, classified Lorca's buildings from field surveys and remote
sensing into six Risk-UE classes: one concrete and five masonry. Finer
masonry classes are the clearest route to better estimates.

## 6. Fragility and damage

A **fragility function** gives the probability that a building of a given
class reaches or exceeds a damage state, as a function of the intensity
measure at its site. TWIN-ER uses the global fragility model of **Martins &
Silva (2021)** [11]. It was derived analytically, by nonlinear dynamic
analysis of building archetypes for each GEM taxonomy class. It is the same
family of models used by GEM's global and European risk models.

The functions follow the usual lognormal form:

$$
P(DS \ge ds_i \mid IM) = \Phi\!\left( \frac{\ln(IM / \theta_i)}{\beta_i} \right)
$$

where:

- $\theta_i$ is the median intensity for damage state $ds_i$;
- $\beta_i$ is its logarithmic standard deviation;
- $\Phi$ is the standard normal cumulative distribution function.

TWIN-ER uses the published curves in tabulated form and interpolates them
at each building's intensity.

There are four damage states, plus None. The descriptions below are
indicative:

| State | Typical structural damage |
|---|---|
| None | No damage |
| Slight | Hairline cracks; repairable without affecting use |
| Moderate | Noticeable cracking; repairs needed before full use |
| Extensive | Large cracks, partial failure of elements; building likely unsafe |
| Complete | Collapse or imminent collapse; not economically repairable |

The probability of being in each state is the difference between
successive exceedance curves:

$$
P(DS = ds_i) = P(DS \ge ds_i) - P(DS \ge ds_{i+1})
$$

with $P(DS \ge \text{None}) = 1$ and $P(DS \ge ds_5) = 0$.

This is the default **damage model**. TWIN-ER can also compute damage with
the capacity-spectrum method (RISK-UE Level II), with either GEM's or
RISK-UE's building data: see [Damage models](/docs/damage-models/).

Each building is evaluated against the intensity measure its own curve is
defined for (see the table in step 2). The state it is shown with follows
the probability level: the most likely state, or the 85th percentile. The
full distribution is kept too:

- the map shows it in each building's popup;
- facilities in the infrastructure list report it;
- the figures for census sections and municipalities are built from it
  (step 8).

## 7. Intensity, infrastructure and debris

**Macroseismic intensity.** Emergency planners in Spain think in EMS-98
intensity degrees [12]. TWIN-ER converts the GMPE's peak ground velocity
(cm/s) to intensity with Worden et al. (2012) [13], as USGS ShakeMap does:

$$
I =
\begin{cases}
3.78 + 1.47 \log_{10}\text{PGV} & \log_{10}\text{PGV} < 0.53 \\
2.89 + 3.16 \log_{10}\text{PGV} & \log_{10}\text{PGV} \ge 0.53
\end{cases}
$$

The relation was fitted for Modified Mercalli intensity. MMI and EMS-98
are broadly equivalent at these levels [14], so it is shown as EMS-98
(estimated). The map draws intensity bands from IV up, contoured from a
grid of at least 1 km.

**Critical infrastructure.** Every hospital, health centre, school,
university, care home, police or emergency station, power plant,
substation, bridge and dam gets the intensity at its location. Those come
from IGN's national topographic base. An asset is listed as affected at
intensity **VI** or more, EMS-98's "slightly damaging". A facility is also
listed below VI if the building it occupies came out damaged.

**Debris envelopes.** Many deaths in the 2011 Lorca earthquake were caused
by façade elements falling onto the street, not by collapse. Following
MERISUR's simulator, each damaged building shows a strip of open ground
around it that its debris could reach: 1, 2, 3 or 4 m for Slight, Moderate,
Extensive or Complete damage. The strips are precomputed per building, and
they only extend towards open space, never over neighbouring buildings.

## 8. Impact

Damage states turn into the figures emergency managers ask for: buildings
and residents affected, residents displaced, repair cost, debris tonnage,
truck trips and shoring props. They are reported per census section and
municipality.

These figures are **expected values**. Each building counts in every
damage state in proportion to its probability of being in it, rather than
only in the single state the map shows. A building that is 60% Slight and
40% Moderate adds 0.6 buildings to Slight and 0.4 to Moderate, with its
dwellings and floor area split the same way.

- **Why:** counting only the most likely state hides the rest of the
  distribution. At moderate shaking, many buildings are most likely Slight
  but have a sizeable chance of Moderate. Those chances add up over a town.
- **Map vs figures:** an area's figures can differ from the number of
  buildings coloured as damaged inside it.
- **Detail:** the [impact estimates](/docs/impact-estimates/) page gives
  each formula and its parameters.

## Validation: Lorca 2011

The 11 May 2011 Lorca earthquake is the reference event:

- **Event.** Mw 5.2, very shallow (a few km deep), on the Alhama de Murcia
  fault.
- **Losses.** Nine deaths. The town's post-earthquake inspection covered
  6,416 of its 7,890 buildings: 4,035 had slight damage (EMS-98 grades
  1–2), 1,328 moderate (grades 2–3), 689 moderate to severe (grades 3–4),
  and 329 had to be demolished (grades 4–5) [15]. That is 2,346 buildings
  with moderate damage or worse.
- **Recorded shaking.** About 0.36 g peak ground acceleration near the
  town.

Re-running it in manual mode on the national data shows:

- **Ground motion.** Median ground motion at Lorca is about half the
  recorded PGA. Median + 1σ (the "low" and "very low" levels) is within a
  few percent of it.
- **Intensity.** The estimate for the town is VI at median and between VI
  and VII at +1σ. IGN observed VII.
- **Damage.** The inspection covered the town, not the whole
  municipality: Lorca is one of Spain's largest municipalities, and
  mostly rural. For a comparable area, TWIN-ER's figures are taken over
  the town's census sections (INE district 01, 7,001 buildings). They are
  expected counts, summed probabilities
  (see [impact estimates](/docs/impact-estimates/#inputs)):

  | | Slight | Moderate | Extensive | Complete | Any damage | Moderate or worse |
  |---|---|---|---|---|---|---|
  | Observed (of 7,890) | 4,035 | 1,328 | 689 *(mod.–severe)* | 329 *(demolished)* | 81% | 30% |
  | High probability | 1,670 | 142 | 25 | 11 | 26% | 3% |
  | Low / very low probability | 3,263 | 868 | 283 | 241 | 67% | 20% |

  At "low" probability, whose ground motion matches the recordings, the
  model is somewhat short of what was observed: two-thirds of buildings
  damaged against four-fifths, and a fifth at moderate or worse against
  nearly a third. The [damage models](/docs/damage-models/#comparison-lorca-2011)
  page compares the other methods.

The comparison is indicative, not a calibration:

- **The town is approximated** by its census district, which leaves out
  some of its built-up fringe.
- **The categories don't match one-to-one.** The inspection's categories
  were set by the town's building-safety forms and span EMS-98 grades
  (moderate is grades 2–3), so they don't map exactly onto the fragility
  model's damage states.

Site amplification is unlikely to be a major source of error: ESRM20's
$V_{S30}$ in Lorca matches local surveys. The fragility model is the larger
uncertainty. Martins & Silva's functions are analytical and global, and
curves calibrated empirically on Mediterranean masonry damage, such as
Risk-UE's, differ from them. Calibrating against Lorca's building-by-building
damage records is the next step.

## Limitations

- **Deterministic scenarios only.** There are no annual probabilities or
  risk curves. A scenario says what *this* earthquake would do, not how
  likely it is.
- **Maximum-magnitude ruptures break the whole modelled fault.**
  Segment-by-segment ruptures and magnitude–frequency distributions are not
  modelled.
- **Three vulnerability classes, assigned from year and height.** There is
  no information on structural system, irregularities, retrofitting or
  state of conservation.
- **Generic fragility functions.** They are global, not calibrated on
  Spanish damage data.
- **Spatial correlation is ignored.** Every building sits at the same point
  of the ground-motion distribution (the chosen $\varepsilon$), rather than
  sampling correlated fields.
- **Only damage to building structure is modelled.** Non-structural damage,
  contents and secondary effects are not: landslides, liquefaction and
  fires.

## References

1. Gaspar-Escribano, J. M., et al. (2017). Methodology for an effective
   risk assessment of urban areas: progress and first results of the
   MERISUR project. *16th World Conference on Earthquake Engineering*.
   [oa.upm.es/49862](https://oa.upm.es/49862/)
2. Pagani, M., Monelli, D., Weatherill, G., et al. (2014). OpenQuake
   Engine: an open hazard (and risk) software for the Global Earthquake
   Model. *Seismological Research Letters*, 85(3), 692–702.
   [doi:10.1785/0220130087](https://doi.org/10.1785/0220130087)
3. IGME. *QAFI v.4: Quaternary Active Faults Database of Iberia*. Instituto
   Geológico y Minero de España.
   [info.igme.es/qafi](https://info.igme.es/qafi/)
4. Wells, D. L., & Coppersmith, K. J. (1994). New empirical relationships
   among magnitude, rupture length, rupture width, rupture area, and
   surface displacement. *Bulletin of the Seismological Society of
   America*, 84(4), 974–1002.
5. Akkar, S., Sandıkkaya, M. A., & Bommer, J. J. (2014). Empirical
   ground-motion models for point- and extended-source crustal earthquake
   scenarios in Europe and the Middle East. *Bulletin of Earthquake
   Engineering*, 12(1), 359–387.
   [doi:10.1007/s10518-013-9461-4](https://doi.org/10.1007/s10518-013-9461-4)
6. Sandıkkaya, M. A., Akkar, S., & Bard, P.-Y. (2013). A nonlinear
   site-amplification model for the next pan-European ground-motion
   prediction equations. *Bulletin of the Seismological Society of
   America*, 103(1), 19–32.
   [doi:10.1785/0120120008](https://doi.org/10.1785/0120120008)
7. Crowley, H., Dabbeek, J., Despotaki, V., et al. (2021). *European
   Seismic Risk Model (ESRM20)*. EFEHR Technical Report 002.
   [doi:10.7414/EUC-EFEHR-TR002-ESRM20](https://doi.org/10.7414/EUC-EFEHR-TR002-ESRM20)
8. Weatherill, G., Crowley, H., Roullé, A., et al. (2023). Modelling site
   response at regional scale for the 2020 European Seismic Risk Model
   (ESRM20). *Bulletin of Earthquake Engineering*, 21, 665–714.
   [doi:10.1007/s10518-022-01526-5](https://doi.org/10.1007/s10518-022-01526-5)
9. Wald, D. J., & Allen, T. I. (2007). Topographic slope as a proxy for
   seismic site conditions and amplification. *Bulletin of the
   Seismological Society of America*, 97(5), 1379–1395.
   [doi:10.1785/0120060267](https://doi.org/10.1785/0120060267)
10. Brzev, S., Scawthorn, C., Charleson, A. W., et al. (2013). *GEM
    Building Taxonomy (Version 2.0)*. GEM Technical Report 2013-02.
    [doi:10.13117/GEM.EXP-MOD.TR2013.02](https://doi.org/10.13117/GEM.EXP-MOD.TR2013.02)
11. Martins, L., & Silva, V. (2021). Development of a fragility and
    vulnerability model for global seismic risk analyses. *Bulletin of
    Earthquake Engineering*, 19, 6719–6745.
    [doi:10.1007/s10518-020-00885-1](https://doi.org/10.1007/s10518-020-00885-1)
12. Grünthal, G. (ed.) (1998). *European Macroseismic Scale 1998
    (EMS-98)*. Cahiers du Centre Européen de Géodynamique et de
    Séismologie, 15.
13. Worden, C. B., Gerstenberger, M. C., Rhoades, D. A., & Wald, D. J.
    (2012). Probabilistic relationships between ground-motion parameters
    and Modified Mercalli intensity in California. *Bulletin of the
    Seismological Society of America*, 102(1), 204–221.
    [doi:10.1785/0120110156](https://doi.org/10.1785/0120110156)
14. Musson, R. M. W., Grünthal, G., & Stucchi, M. (2010). The comparison of
    macroseismic intensity scales. *Journal of Seismology*, 14, 413–428.
    [doi:10.1007/s10950-009-9172-0](https://doi.org/10.1007/s10950-009-9172-0)
15. Feriche, M., Vidal, F., Alguacil, G., Navarro, M., & Aranda, C. (2012).
    Vulnerabilidad y daño en el terremoto de Lorca de 2011. *Física de la
    Tierra*, 24, 255–287.
