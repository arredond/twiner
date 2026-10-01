---
title: Damage models
description: The calculation methods and vulnerability databases twinQUAKE can use, what each needs and produces, and how each database was derived.
---

An earthquake scenario turns ground motion into building damage through
two independent choices:

- a **damage model**: the calculation method, which turns ground motion
  and a building's vulnerability data into the probability of each damage
  state;
- a **vulnerability database**: where each building class's vulnerability
  data comes from.

A combination is valid when the database provides the data the model
needs. In the app, pick one in the twinQUAKE card under **Damage model**.
In the API, pass `damage_model` and `vulnerability_db` to
[`/scenarios/fault`](/docs/api/operations/run_fault_scenario/) or
[`/scenarios/manual`](/docs/api/operations/run_manual_scenario/);
[`GET /methods`](/docs/api/operations/list_methods/) lists everything below
in machine-readable form.

| Damage model | Vulnerability database | In the app |
|---|---|---|
| `fragility` | `gem` | Fragility curves (GEM). **Default** |
| `capacity_spectrum` | `gem` | Capacity spectrum (GEM curves) |
| `capacity_spectrum` | `risk_ue` | Capacity spectrum (RISK-UE) |

The probability levels apply to all of them in the same way: +1σ raises
every ground-motion input, and "very low" reports the 85th-percentile
damage state of whatever distribution the model produces (see
[twinQUAKE](/docs/hazards/earthquake/#4-probability-levels)).

## Inputs and outputs

### Damage models

| | **Fragility functions** (`fragility`) | **Capacity spectrum** (`capacity_spectrum`) |
|---|---|---|
| Method | Read each building's damage probabilities off a fragility curve, at the intensity measure the curve is defined for | RISK-UE Level II: find where the building's capacity curve meets the site's demand spectrum, then apply lognormal fragility on that displacement |
| Vulnerability data needed | Fragility functions per class | Capacity curves per class |
| Ground motion needed (per 1 km cell) | PGA, SA(0.3 s), SA(0.6 s) or SA(1.0 s), depending on the class | SA at each class's elastic period; PGA and PGV (for the spectrum's corner period) |
| Exposure needed (per building) | Vulnerability class, height class | Vulnerability class, height class |
| Output (per building) | Probability of None, Slight, Moderate, Extensive, Complete | Same, plus the performance-point spectral displacement |

Both produce the same damage states, so the map, the impact estimates,
the infrastructure list and the API work unchanged whichever one runs.

### Vulnerability databases

| | **GEM** (`gem`) | **RISK-UE** (`risk_ue`) |
|---|---|---|
| Provides | Fragility functions and capacity curves | Capacity curves only |
| Classes | TWIN-ER's three classes directly, 1–12 storeys (masonry up to 5) | Mapped from TWIN-ER's classes (below), by height band |
| How it was derived | Analytical: nonlinear dynamic analyses of each class's equivalent single-degree-of-freedom model under a large set of ground-motion records [1] | Mechanical: pushover analyses of representative European buildings by the RISK-UE partners, idealised as bilinear curves [2] |
| Damage-state thresholds (capacity spectrum) | RISK-UE's (see below) | RISK-UE's |
| Source and licence | Martins & Silva (2021), [GitHub](https://github.com/lmartins88/global_fragility_vulnerability), CC BY-SA 4.0 | RISK-UE WP4 report (2003), Tables 3.1-1 and 3.1-2 |

## The capacity-spectrum model

This is the RISK-UE Level II method (LM2) [2, 3], the same family of
methods MERISUR uses. For each building class it starts from a **capacity
curve**: how much lateral acceleration $S_a$ the building's equivalent
single-degree-of-freedom system resists as its displacement $S_d$ grows.
It is idealised as bilinear, with a yield point $(D_y, A_y)$ and an
ultimate displacement $D_u$.

**1. Elastic period.** From the yield point:

$$
T_e = 2\pi\sqrt{\frac{D_y}{A_y\,g}}
$$

**2. Demand.** The site's 5%-damped elastic spectral acceleration at that
period, $S_{ae} = SA(T_e)$, from the same ground-motion model as every
other path (Akkar et al. 2014, with site amplification and the chosen
probability level), and the spectrum's corner period $T_C$, where it
switches from constant acceleration to constant velocity. $T_C$ comes from
the site's own PGA and PGV with Newmark & Hall's median spectral
amplification factors for 5% damping [4]:

$$
T_C = 2\pi\,\frac{1.65\,\text{PGV}}{2.12\,\text{PGA}}
$$

**3. Performance point.** The displacement the earthquake imposes on the
building, in closed form for an elastic-perfectly-plastic curve (the N2
method [5], RISK-UE WP4 Eqs. 3-16 to 3-18). With the elastic displacement
$S_{de} = S_{ae}\,g\,(T_e/2\pi)^2$ and $R = S_{ae}/A_y$:

$$
S_d =
\begin{cases}
S_{de} & R \le 1 \text{ (elastic), or } T_e \ge T_C \text{ (equal displacement)} \\[1ex]
D_y\left[(R-1)\,\dfrac{T_C}{T_e} + 1\right] & \text{otherwise}
\end{cases}
$$

**4. Damage.** Lognormal fragility on spectral displacement:

$$
P(DS \ge ds_k \mid S_d) = \Phi\!\left(\frac{\ln(S_d / S_{d,k})}{\beta_k}\right)
$$

with RISK-UE's thresholds and dispersions, all derived from the capacity
curve itself (WP4 Table 3.8) [2]. With the ultimate ductility
$\mu_u = D_u/D_y$:

| State | Threshold $S_{d,k}$ | Dispersion $\beta_k$ |
|---|---|---|
| Slight | $0.7\,D_y$ | $0.25 + 0.07\ln\mu_u$ |
| Moderate | $D_y$ | $0.20 + 0.18\ln\mu_u$ |
| Extensive | $D_y + 0.25\,(D_u - D_y)$ | $0.10 + 0.40\ln\mu_u$ |
| Complete | $D_u$ | $0.15 + 0.50\ln\mu_u$ |

Moderate damage starts at yield. Note that this is a stricter definition
than the GEM fragility functions use (see [Comparison](#comparison-lorca-2011)).

## The vulnerability databases

### GEM: Martins & Silva (2021)

The Global Earthquake Model's global fragility and vulnerability model [1].
For each building class in the GEM taxonomy, the authors:

1. built a capacity curve from the class's structural properties;
2. ran nonlinear dynamic analyses of its equivalent single-degree-of-freedom
   system under a large set of recorded ground motions;
3. fitted fragility functions to the resulting damage, against whichever
   intensity measure predicted it best.

TWIN-ER uses three classes (see [twinQUAKE](/docs/hazards/earthquake/#5-exposure-and-vulnerability-classes)).
The **fragility** model reads their fragility functions directly. The
**capacity spectrum** model uses their published capacity curves, which
have four points: origin, cracking, yield and ultimate. TWIN-ER takes the
yield point as $(D_y, A_y)$ and the last point as $D_u$. Masonry classes
stop at 5 storeys; taller masonry buildings use the 5-storey curve.

### RISK-UE (2003)

RISK-UE (*An advanced approach to earthquake risk scenarios with
applications to different European towns*, EU contract EVK4-CT-2000-00014)
developed vulnerability models for European building types [2]. Its
partners derived capacity curves from pushover analyses of
representative building models:

- the University of Genoa (UNIGE) for unreinforced masonry;
- Aristotle University of Thessaloniki (AUTh) for reinforced concrete.

The curves are tabulated by building type, height band and seismic-code
level.

RISK-UE's building types are more detailed than what the cadastre can
tell apart. TWIN-ER maps each of its own classes to the closest one:

| TWIN-ER class | RISK-UE type | Code level | Height bands |
|---|---|---|---|
| `CR_LDUAL-DUL` (concrete, 1970 or later) | RC1: concrete moment frames | Low code | L 1–2, M 3–5, H 6+ storeys |
| `MUR_LWAL-DNO` (masonry, 1940–1969) | M3.4: unreinforced masonry with RC slabs | Pre-code | L, M, H |
| `MUR-STRUB_LWAL-DNO` (masonry, before 1940) | M1.1: rubble stone, fieldstone | Pre-code | L, M, H |

The parameters used, from WP4 Tables 3.1-1 and 3.1-2:

| Type | $D_y$ (cm) | $A_y$ (g) | $D_u$ (cm) | $T_e$ (s) | Source |
|---|---|---|---|---|---|
| M1.1 L / M / H | 0.38 / 0.47 / 0.66 | 0.173 / 0.115 / 0.058 | 1.93 / 2.03 / 2.28 | 0.30 / 0.41 / 0.68 | UNIGE |
| M3.4 L / M / H | 0.53 / 0.75 / 0.92 | 0.297 / 0.149 / 0.099 | 3.18 / 3.47 / 3.67 | 0.27 / 0.45 / 0.61 | UNIGE |
| RC1 L / M / H | 2.32 / 4.27 / 5.76 | 0.192 / 0.170 / 0.124 | 9.58 / 10.77 / 14.83 | 0.70 / 1.01 / 1.37 | AUTh |

The main difference from GEM is concrete: RISK-UE's low-code RC frames
yield at about a third of the acceleration of GEM's (0.19 g against 0.56 g
for low-rise), so they come out much more vulnerable. The masonry curves
are close to GEM's.

## Comparison: Lorca 2011

The 2011 Lorca earthquake (Mw 5.2, manual mode) with each method. These
are buildings in each damage state across the municipality of Lorca
(27,884 buildings):

| Level | Method | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|---|
| High | Fragility (GEM) | 565 | 0 | 0 | 0 |
| | Capacity spectrum (GEM) | 1,883 | 3,132 | 0 | 0 |
| | Capacity spectrum (RISK-UE) | 1,254 | 4,825 | 5 | 0 |
| Low | Fragility (GEM) | 10,554 | 0 | 0 | 0 |
| | Capacity spectrum (GEM) | 852 | 11,047 | 1,229 | 0 |
| | Capacity spectrum (RISK-UE) | 2,799 | 8,491 | 2,673 | 222 |
| Very low | Fragility (GEM) | 8,641 | 4,745 | 1,075 | 0 |
| | Capacity spectrum (GEM) | 1,684 | 5,328 | 6,991 | 4,571 |
| | Capacity spectrum (RISK-UE) | 2,944 | 4,208 | 7,229 | 5,799 |

For reference, the town's post-earthquake inspection found 2,346 of its
7,890 buildings with moderate damage or worse (see
[twinQUAKE](/docs/hazards/earthquake/#validation-lorca-2011)).

The capacity-spectrum results are much more severe, even with the same GEM
data. Most of the difference comes from the damage-state definitions:
RISK-UE starts Moderate damage at the yield displacement, while GEM's own
fragility functions use milder thresholds. With RISK-UE's thresholds, the
capacity-spectrum model already exceeds the observed damage at "low"
probability, the level whose ground motion matches what was recorded in
Lorca. At "high" probability it is of the right order. Treat these
methods as alternatives to compare, not as calibrated predictions.

## Limitations

- **One set of damage thresholds.** Both databases use RISK-UE's
  thresholds with the capacity-spectrum model. GEM's own thresholds, which
  would make "capacity spectrum (GEM)" consistent with GEM's fragility
  functions, are not yet implemented.
- **Elastic-perfectly-plastic curves.** The closed-form performance point
  ignores any post-yield hardening ($A_u > A_y$).
- **Corner period from PGA and PGV.** $T_C$ uses median spectral
  amplification factors, not the ground-motion model's full spectral
  shape.
- **RISK-UE's curves come from Italian and Greek prototype buildings**, not
  from Spanish ones. RISK-UE also has curves derived for Barcelona (CIMNE)
  for some types, not yet used.
- **The class mapping is coarse**, like the classes themselves: it relies
  on construction year and storeys only.

## References

1. Martins, L., & Silva, V. (2021). Development of a fragility and
   vulnerability model for global seismic risk analyses. *Bulletin of
   Earthquake Engineering*, 19, 6719–6745.
   [doi:10.1007/s10518-020-00885-1](https://doi.org/10.1007/s10518-020-00885-1)
2. Milutinovic, Z. V., & Trendafiloski, G. S. (2003). *RISK-UE, WP4:
   Vulnerability of current buildings*. RISK-UE project report,
   EVK4-CT-2000-00014.
3. Lagomarsino, S., & Giovinazzi, S. (2006). Macroseismic and mechanical
   models for the vulnerability and damage assessment of current
   buildings. *Bulletin of Earthquake Engineering*, 4(4), 415–443.
   [doi:10.1007/s10518-006-9024-z](https://doi.org/10.1007/s10518-006-9024-z)
4. Newmark, N. M., & Hall, W. J. (1982). *Earthquake Spectra and Design*.
   Earthquake Engineering Research Institute, Oakland, CA.
5. Fajfar, P. (2000). A nonlinear analysis method for performance-based
   seismic design. *Earthquake Spectra*, 16(3), 573–592.
   [doi:10.1193/1.1586128](https://doi.org/10.1193/1.1586128)
