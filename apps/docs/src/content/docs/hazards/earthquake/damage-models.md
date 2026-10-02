---
title: Damage models
description: The calculation methods, vulnerability databases and building classification schemes twinQUAKE can use, what each needs and produces, and how each was derived.
---

An earthquake scenario turns ground motion into building damage through
three choices:

- a **damage model**: the calculation method, which turns ground motion
  and a building's vulnerability data into the probability of each damage
  state;
- a **vulnerability database**: where each building class's vulnerability
  data comes from;
- a **classification scheme**: how each building was given a class in the
  database's taxonomy.

A combination is valid when the database provides the data the model
needs, and the scheme gives classes in the database's taxonomy. Every
scheme is computed in advance for every building, so switching scheme or
database never translates one taxonomy into another.

In the app, pick a combination in the twinQUAKE card under **Damage
model**; each database uses its default scheme. In the API, pass
`damage_model`, `vulnerability_db` and, optionally, `classification` to
[`/scenarios/fault`](/docs/api/operations/run_fault_scenario/) or
[`/scenarios/manual`](/docs/api/operations/run_manual_scenario/);
[`GET /methods`](/docs/api/operations/list_methods/) lists everything below
in machine-readable form.

| Damage model | Vulnerability database | Classification (default) | In the app |
|---|---|---|---|
| `fragility` | `gem` | `gem_heuristic` | Fragility curves (GEM). **Default** |
| `capacity_spectrum` | `gem` | `gem_heuristic` | Capacity spectrum (GEM curves) |
| `capacity_spectrum` | `risk_ue` | `risk_ue_feriche2012` | Capacity spectrum (RISK-UE) |

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
| Exposure needed (per building) | Class in the database's taxonomy, storeys | Class in the database's taxonomy, storeys |
| Output (per building) | Probability of None, Slight, Moderate, Extensive, Complete | Same, plus the performance-point spectral displacement |

Both produce the same damage states, so the map, the impact estimates,
the infrastructure list and the API work unchanged whichever one runs.

### Vulnerability databases

| | **GEM** (`gem`) | **RISK-UE** (`risk_ue`) |
|---|---|---|
| Provides | Fragility functions and capacity curves | Capacity curves only |
| Taxonomy | GEM building taxonomy | RISK-UE building types, with code level and height band |
| Classes with data | Three classes used, 1–12 storeys (masonry up to 5) | M1.2, M3.4, RC1 (pre-code); RC1, RC3.1, RC3.2 (low code); others use the nearest (below) |
| How it was derived | Analytical: nonlinear dynamic analyses of each class's equivalent single-degree-of-freedom model under a large set of ground-motion records [1] | Mechanical: pushover analyses of representative European buildings by the RISK-UE partners, idealised as bilinear curves [2] |
| Damage-state thresholds (capacity spectrum) | RISK-UE's (see below) | RISK-UE's |
| Source and licence | Martins & Silva (2021), [GitHub](https://github.com/lmartins88/global_fragility_vulnerability), CC BY-SA 4.0 | RISK-UE WP4 report (2003), Tables 3.1-1 and 3.1-2 |

### Classification schemes

| | **GEM heuristic** (`gem_heuristic`) | **RISK-UE, Feriche et al. 2012** (`risk_ue_feriche2012`) |
|---|---|---|
| Taxonomy | GEM | RISK-UE |
| Building attributes | Construction year, floors | Construction year, floors |
| Site attributes | None | NCSE-02 basic acceleration $a_b$ of the municipality |
| Rule | Material and system by construction era | Feriche et al.'s typology matrix for Lorca [6]; code level by era and $a_b$ |
| Classes | 3, by storeys | 5 types × 3 code levels × 3 height bands |

The [twinQUAKE](/docs/hazards/earthquake/#5-exposure-and-vulnerability-classes)
page gives both rules in full. Each scheme states the attributes it needs,
so a deployment elsewhere can enable only the schemes its data supports.

## The fragility-function model

The most direct method: each building class has a set of **fragility
functions**, one per damage state, giving the probability of reaching or
exceeding that state as a lognormal function of one intensity measure at
the site:

$$
P(DS \ge ds_i \mid IM) = \Phi\!\left( \frac{\ln(IM / \theta_i)}{\beta_i} \right)
$$

with the median $\theta_i$ and dispersion $\beta_i$ of each state. Each
curve is defined against the intensity measure that best predicts its
class's damage (PGA, or SA at 0.3, 0.6 or 1.0 s), so the scenario computes
only those. TWIN-ER reads the published curves in tabulated form and
interpolates them at each building's intensity. The damage-state
thresholds are the database's own: here, Martins & Silva's [1].

Fragility functions summarise a building class's behaviour, so the method
is fast and needs only the class. Only GEM provides them.

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

TWIN-ER gives each building a RISK-UE type, code level and height band
with the `risk_ue_feriche2012` scheme (see
[twinQUAKE](/docs/hazards/earthquake/#risk-ue-classes-risk_ue_feriche2012)).
The parameters used, from WP4 Tables 3.1-1 (pre-code) and 3.1-2 (low
code):

| Type | Code | $D_y$ (cm) | $A_y$ (g) | $D_u$ (cm) | $T_e$ (s) | Source |
|---|---|---|---|---|---|---|
| M1.2 L / M / H | Pre | 0.15 / 0.31 / 0.48 | 0.150 / 0.120 / 0.100 | 1.55 / 1.69 / 1.85 | 0.20 / 0.32 / 0.44 | UNIGE |
| M3.4 L / M / H | Pre | 0.53 / 0.75 / 0.92 | 0.297 / 0.149 / 0.099 | 3.18 / 3.47 / 3.67 | 0.27 / 0.45 / 0.61 | UNIGE |
| RC1 L / M / H | Pre | 0.77 / 2.21 / 3.86 | 0.187 / 0.156 / 0.073 | 4.47 / 8.79 / 11.48 | 0.41 / 0.76 / 1.46 | UNIGE |
| RC1 L / M / H | Low | 2.32 / 4.27 / 5.76 | 0.192 / 0.170 / 0.124 | 9.58 / 10.77 / 14.83 | 0.70 / 1.01 / 1.37 | AUTh |
| RC3.1 L / M / H | Low | 0.44 / 0.85 / 2.14 | 1.541 / 0.808 / 0.455 | 1.87 / 2.63 / 5.98 | 0.11 / 0.21 / 0.44 | AUTh |
| RC3.2 L / M / H | Low | 1.63 / 1.90 / 2.26 | 0.182 / 0.198 / 0.253 | 6.37 / 7.87 / 7.80 | 0.60 / 0.62 / 0.60 | AUTh |

WP4 also gives a low-rise M1.2 curve from AUTh; TWIN-ER uses UNIGE's, so
that all masonry curves come from the same partner and method.

**Missing curves use the nearest available one.** WP4 doesn't tabulate a
curve for every type and code level the scheme assigns. TWIN-ER then uses
the nearest available curve, and says so:

| Assigned | Uses | Why |
|---|---|---|
| M3.1, pre-code | M1.2, pre-code | WP4 has no M3.1 curve. M1.2 (simple stone) has the same Level I vulnerability index, $V^* = 0.74$ (WP4 Table 2.2) |
| RC3.1, pre- or moderate-code | RC3.1, low-code | RC3.1 is only tabulated at low code |
| RC3.2, pre- or moderate-code | RC3.2, low-code | RC3.2 is only tabulated at low code |

The substitutions matter. Moderate-code RC3.x, every building from 1997 in
a seismic municipality, uses low-code curves and so is likely
**overestimated** in vulnerability. Pre-code RC3.x, the same years where
$a_b < 0.04$ g, is likely underestimated, though those areas see little
shaking.

The main difference from GEM is concrete. RISK-UE's RC1 frames yield at
about a third of the acceleration of GEM's concrete class (0.19 g against
0.56 g for low-rise), so they come out much more vulnerable. RC3.1, the
infilled frames assigned to buildings from 2005, is by contrast very stiff
and strong. For masonry, M3.4 is close to GEM's mid-century class (yield at
0.30 g against 0.29 g for two storeys), while M1.2, used for the oldest
buildings, is weaker than GEM's rubble stone (0.15 g against 0.24 g).

## Comparison: Lorca 2011

The [twinQUAKE validation](/docs/hazards/earthquake/#validation-lorca-2011)
compares every model, at every probability level, with the damage
inspected in the town of Lorca after the 2011 earthquake. In short: at
the level whose ground motion matches the recordings, the fragility model
somewhat underestimates the observed damage and both capacity-spectrum
variants overestimate it, mostly because of how each defines the damage
states. Treat the models as alternatives to compare, not as calibrated
predictions.

The town's 7,001 buildings get these RISK-UE classes: 2,029 M3.1, 707
M3.4, 1,120 pre-code and 2,187 low-code RC1, 434 RC3.2 and 524 RC3.1 (both
moderate-code, so on low-code curves).

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
- **The classification schemes are coarse.** They rely on construction
  year and storeys (plus, for RISK-UE, the seismic zone). The RISK-UE
  scheme comes from Lorca and is applied to all of Spain.
- **Some RISK-UE classes use another class's curve** (see
  [above](#risk-ue-2003)): M3.1 uses M1.2, and RC3.x uses its low-code
  curve at every code level.

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
6. Feriche, M., Vidal, F., Alguacil, G., Navarro, M., & Aranda, C. (2012).
   Vulnerabilidad y daño en el terremoto de Lorca de 2011. *Física de la
   Tierra*, 24, 255–287.
