# Investigation: applying RISK-UE LM1, and multi-methodology vulnerability classes

Status: **implementation planned** (see the plan below; originally research only). Written in response to
`docs/validation-lorca-2011.md` §11.2 flagging RISK-UE LM1 as the more
likely explanation for the remaining twiner/MERISUR gap at Lorca, and a
request to scope (a) what implementing it would take and (b) whether
buildings could carry multiple vulnerability classifications (one per
methodology) so a scenario can pick which one to run against.

## Implementation plan (2026-10-02), for the next session

Status: **ready to implement.** Everything below "Background" is the
original scoping pass (2026-09/10-01), kept for its reasoning; where it
disagrees with this plan, this plan wins. Two of its blockers are gone:

- **Classes (§5):** done by ADR-0035. Every building already carries
  `risk_ue_class` (M3.1, M3.4, RC1, RC3.1, RC3.2), `risk_ue_code_level`
  and `risk_ue_height`, from Feriche et al. (2012)'s Lorca matrix, the
  same paper that applied LM1 to Lorca.
- **Intensity (§3):** settled as option (a), a GMICE on what we already
  compute: Worden et al. (2012) PGV → intensity
  (`infrastructure.mmi_from_pgv`, ADR-0025). Its under-estimate at Lorca
  (6.6 at +1σ against VII observed) is **accepted for now**; validation
  and calibration come later. Swapping in an IPE or another GMICE later
  only changes the hazard input, not the model.

### The model, as WP4 specifies it (verified against the report)

Milutinovic & Trendafiloski (2003), *RISK-UE WP4*, chapter 2:

- **Vulnerability index** (Eq. 2-8): $V_I = V_I^* + \Delta V_R + \Delta V_m$.
- **Mean damage grade** (Eq. 2-4), with $Q = 2.3$:
  $\mu_D = 2.5\,[1 + \tanh((I + 6.25\,V_I - 13.1)/2.3)]$.
- **Damage distribution** (Eqs. 2-1 to 2-3, 2-11): beta with $a = 0$,
  $b = 6$, $t = 8$, $r = t\,(0.007\mu_D^3 - 0.052\mu_D^2 + 0.2875\mu_D)$;
  grade $k$'s probability is $p_k = P_\beta(k+1) - P_\beta(k)$ for
  $k = 0..5$ (D0 = no damage to D5 = destruction).

$V_I^*$ for the five types we assign (WP4 Table 2.2; also $V^-$, $V^+$,
$V_{min}$, $V_{max}$, to vendor with them):

| Type | $V_{min}$ | $V^-$ | $V^*$ | $V^+$ | $V_{max}$ |
|---|---|---|---|---|---|
| M3.1 Wooden slabs | 0.46 | 0.65 | 0.74 | 0.83 | 1.02 |
| M3.4 RC slabs | 0.30 | 0.49 | 0.616 | 0.793 | 0.86 |
| RC1 Moment frames | −0.02 | 0.047 | 0.442 | 0.80 | 1.02 |
| RC3.1 Regularly infilled | −0.02 | 0.007 | 0.402 | 0.76 | 0.98 |
| RC3.2 Irregular frames | 0.06 | 0.127 | 0.522 | 0.88 | 1.02 |

Unlike the capacity curves (ADR-0035), LM1 has a value for **every** type
we assign, M3.1 included: no substitutions.

**Behaviour modifiers we can compute from stored attributes** (WP4
Tables 2.4 and 2.5; everything else needs a survey and defaults to 0):

| | Low (1–2) | Mid (3–5) | High (6+) | Code level |
|---|---|---|---|---|
| Masonry | −0.02 | +0.02 | +0.06 | — |
| RC, pre or low code | −0.04 | 0 | +0.08 | +0.16 |
| RC, moderate ("medium") code | −0.04 | 0 | +0.06 | 0 |

$\Delta V_R$ (regional factor, expert judgement) is 0 by default.

### Decisions to confirm at the start of the session

1. **Modifiers.** Recommended default: WP4's floors and code-level
   modifiers above (computable for every building). Alternatives: $V^*$
   only, or additionally Feriche et al.'s Lorca-calibrated values (their
   Tables 3 and 4, e.g. vertical irregularity +0.06, short column +0.08
   for Lorca RC). The Lorca set would be a second, explicitly
   Lorca-calibrated option, never the national default.
2. **Grade → state mapping** (§4). Recommended: D0 → None, D1 → Slight,
   D2 → Moderate, D3 → Extensive, D4 + D5 → Complete, documented as a
   modelling choice. The response keeps our five states; the six-grade
   distribution is also kept where it's cheap (validate_lorca), because
   Lorca's inspection categories are themselves EMS-98 grade ranges.
3. **Uncertainty range** ($V^-$/$V^+$, $\Delta V_f$). Recommended: not
   used at first ($V^*$ only); the probability levels keep doing what
   they do for every model (+1σ ground motion; 85th-percentile state).

### Work, in order

1. **Data.** Vendor `vulnerability_data/risk_ue_2003_vulnerability_index.csv`
   (the five Table 2.2 rows above, cited by table) and
   `risk_ue_2003_behaviour_modifiers.csv` (the modifier rows used), with
   their README entries.
2. **Registry** (`methods.py`). A third data kind `vulnerability_index`;
   `risk_ue` provides it alongside capacity curves. A third model,
   `macroseismic` ("Macroseismic (RISK-UE Level I)"): needs
   `vulnerability_index`; hazard input EMS-98 intensity from PGV (Worden
   et al. 2012); exposure input the `risk_ue_feriche2012` class (type,
   code level, height band, already in `class_sql`). Valid combinations
   become four: `macroseismic` + `risk_ue` + `risk_ue_feriche2012` is new.
3. **Model** (new `macroseismic.py`, the counterpart of
   `capacity_spectrum.py`): parse the class key, compute $V_I$, $\mu_D$
   and the beta grade probabilities per (class, intensity) group, map
   grades to states, return `DamageArrays` with `im_value` = intensity and
   `im_type` "EMS-98 intensity". Move `mmi_from_pgv` somewhere both
   `infrastructure.py` and the model import (e.g. `ground_motion.py`).
4. **Engine** (`engine._evaluate_batches`): a `macroseismic` branch that
   asks the grid for PGV only and calls the new model.
5. **Tests.** μD against hand-computed values of Eq. 2-4; probabilities
   sum to 1 and rise with $I$ and $V$; modifiers per class key; the
   registry's four combinations; the API runs it on both routes (local and
   handler); scenario ids differ per method (already guaranteed).
6. **Validation.** `validate_lorca` gains the new method's rows, plus a
   six-grade table for LM1 next to the inspection's grade ranges. Record
   the numbers, with the intensity caveat, in
   `validation-lorca-2011.md` §16. No calibration yet.
7. **API and frontend.** Bump `API_VERSION` (CHANGELOG-API.md), re-export
   the OpenAPI spec and its Spanish catalog. The dropdown picks the method
   up from `GET /methods` on its own; add the `method.macroseismic:risk_ue`
   label (en/es).
8. **Docs.** ADR-0036; the Damage models page (en/es) gains a
   "Macroseismic model" section (formulas, $V^*$ table, modifiers, grade
   mapping, intensity source and its known under-estimate) and the new
   comparison rows; twinQUAKE §6 mentions the third model.

No data rebuild is needed: LM1 only reads classes already in
`exposure.parquet`.

## Background: the original scoping pass

**Confidence key**, matching `merisur.md`'s convention: 🟢 stated
explicitly in a primary source · 🟡 inferred with reasonable confidence ·
🔴 unverified/approximate, needs checking before relied on.

## 1. What RISK-UE LM1 actually computes

RISK-UE LM1 ("Level 1", the macroseismic/vulnerability-index method,
Giovinazzi & Lagomarsino 2004/2006) is a different **category** of model
from what `twiner` runs today, not just a different data source. Core
formula 🟢 (verified against multiple independent citations of the same
published equation):

```
μD = 2.5 · [1 + tanh((I + 6.25·V − 13.1) / Q)]
```

- `μD` — mean damage grade, continuous in `[0, 5]` (EMS-98 has **5**
  damage grades: D1 Negligible/Slight ... D5 Destruction — not the same
  cardinality as the **4** HAZUS-style states `twiner` uses today, None/
  Slight/Moderate/Extensive/Complete; a mapping between the two grade
  systems is needed regardless of everything else below, see §4).
- `I` — macroseismic intensity, **EMS-98 scale**, a single scalar per
  site (not PGA/SA/any instrumental ground-motion measure).
- `V` — vulnerability index, normalized to `[0, 1]`, one value per
  building (assigned from its typology, then adjusted by modifiers — §2).
- `Q` — a ductility/behaviour constant, 🟡 commonly cited around 2.3–3
  depending on typology (sources disagree on the exact per-typology
  table; not independently verified here).
- Damage-grade probabilities are then distributed around `μD` via a
  **binomial or beta distribution** (sources differ on which — both are
  used in different RISK-UE-derived papers 🔴), not read off a vendored
  curve the way `fragility_lookup.py` does today.

## 2. What per-building inputs it needs

1. **A RISK-UE/EMS-98 typological vulnerability class** (masonry M1–M7,
   RC1–RC2, steel, wood — the same Risk-UE Model Building Type taxonomy
   `merisur.md` §4.5 already documents 6 classes of for Lorca) with a
   published baseline vulnerability index `Vi*` and bounds `(V−, V+)`. 🟢
   for the taxonomy's existence; 🔴 for the exact numeric `Vi*` table (the
   primary sources found are paywalled/blocked — every fetch attempt at
   the original Giovinazzi & Lagomarsino papers and a UPM-adjacent
   doctoral thesis covering this exact chapter returned 403; only
   secondhand citations were reachable, giving rough bands like
   masonry `V ≈ 0.55–0.95` across sub-types, RC generally lower — **not
   solid enough to vendor without the real table**, itself a good
   candidate for `questions-for-upm.md` #1, next to the LM1
   behaviour-modifier ask already added there).
2. **Behaviour modifiers (ΔVm)**: adjustments to `Vi*` for a specific
   building's condition, regularity in plan/height, position in block
   (end-of-terrace vs. interior), ground morphology, etc. — the same kind
   of per-building structural detail Risk-UE's own field campaigns
   collected for Lorca (`merisur.md` §4.5 item 1) and that `twiner`'s
   Catastro-only pipeline still can't observe (no field survey, by
   project constraint). Practically: most of these modifiers would have
   to default to "no adjustment" for every building, same posture as
   today's taxonomy heuristic defaulting ductility to "low/none"
   (`taxonomy.py`'s own docstring).
3. **A regional vulnerability factor (ΔVR)**: an expert-judgment
   correction for how a *specific region's* stock of a given typology
   compares to the pan-European baseline — this is exactly what the
   Lorca-recalibrated behaviour modifiers found in
   `validation-lorca-2011.md` §11.2 (the *"Proposal for new values of
   behaviour modifiers ... applied to Lorca"* paper) provide, and why
   getting that paper specifically (not just the generic RISK-UE tables)
   matters more than the generic ones for a Lorca comparison to be fair.
4. **Macroseismic intensity `I` at each building's site** — see §3, the
   real blocker.

## 3. The real blocker: `I` is not an output `twiner` currently produces

`twiner`'s entire hazard chain (`ground_motion.py`) computes **PGA/SA**
via the Akkar, Sandıkkaya & Bommer (2014) GMPE — an instrumental ground-
motion measure, not macroseismic intensity. RISK-UE LM1 needs the latter.
Two ways to bridge this, both real engineering choices, not a data lookup:

- **(a) A Ground-Motion-to-Intensity Conversion Equation (GMICE)**:
  convert the PGA/SA `twiner` already computes into an equivalent EMS-98
  intensity per site. Precedent exists (USGS ShakeMap uses this
  internally, e.g. Worden et al. 2012 for PGA/PGV→MMI; EMS-98 and MMI are
  close enough in practice that cross-application is common but not
  exact 🟡). Advantage: reuses the existing Akkar-based hazard chain and
  ADR-0015's site amplification unchanged — only a new conversion step at
  the very end. Disadvantage: stacking two approximations (GMPE → GMICE)
  instead of one, and losing whatever calibration benefit LM1's original
  authors intended from using a *directly observed/predicted* macroseismic
  intensity.
- **(b) An Intensity Prediction Equation (IPE)**: a GMPE-like model that
  predicts EMS-98/MMI intensity directly from magnitude, distance,
  rupture geometry — skipping PGA/SA entirely for this path. Advantage:
  no double-approximation. Disadvantage: a second, independent hazard
  model to source, vendor, and maintain in parallel with Akkar et al.
  (2014) — a Spain/Europe-calibrated modern IPE would need its own
  literature search (not done here, out of scope for this pass), and
  running two parallel hazard calculations per scenario roughly doubles
  that portion of the compute cost.

**This is the single biggest scoping unknown** — bigger than the Vi*
table gap in §2, because it determines the shape of the whole
implementation (one new terminal step vs. a second parallel hazard
pipeline). Worth resolving with a follow-up literature check specifically
on GMICE-vs-IPE choice before committing to either, not decided here.

## 4. Damage-grade cardinality mismatch (5 EMS-98 grades vs. 4 HAZUS states)

Independent of the `I` question: LM1 natively produces a probability
distribution over EMS-98's 5 damage grades (D1–D5), while every consumer
downstream of `damage.py` today — the API response shape, the frontend's
`DAMAGE_COLORS`/damage-state legend, the municipality-stats aggregation —
is built around the 4-state HAZUS-style vocabulary (`None`/`Slight`/
`Moderate`/`Extensive`/`Complete`, 5 labels but note "None" is a 0th state
prepended in `damage.py`, not one of the 4 `DAMAGE_STATES_ASCENDING`).
A grade-to-state mapping (e.g. D1→Slight, D2→Moderate, D3→Extensive,
D4/D5→Complete, or some other split) would need to be defined and
documented as a modeling choice in its own right, not just a schema
formality — EMS-98's D1/D2 split in particular doesn't cleanly land on
HAZUS's None/Slight boundary.

## 5. Multi-methodology vulnerability classification: architecturally straightforward

This part of the ask is **good news** — the codebase already has the
right shape for it, because it already does something structurally
similar. `pipelines/exposure/taxonomy.py`'s `assign_taxonomy` derives a
GEM/Martins-&-Silva class from the same two Catastro signals
(`construction_year`, `floors`) that would drive an EMS-98/RISK-UE class
assignment — a second, parallel classifier function reading the same
inputs, not a different pipeline stage.

Concretely, following the exact precedent `municipality_code` (ADR-0014)
and `vs30` (ADR-0015) already set — a column stamped once at ingest time,
not derived per request:

- `pipeline.build_exposure` gains a second classification call (e.g.
  `assign_risk_ue_class(construction_year, floors) -> (ems98_class, vi_star)`,
  mirroring `assign_taxonomy`'s signature) alongside the existing one,
  writing new columns onto `exposure.parquet` — `risk_ue_class` (the A–F
  EMS-98 vulnerability class letter or M1–M7/RC1–RC2 typology code) and
  `vi_star` (or the modifier-adjusted `V`, once §2's modifiers are
  decided). `taxonomy_class`/`height_class` stay exactly as they are —
  this is additive, not a replacement.
- `services/scenario/engine.py` gains a `damage_model` selector, the same
  shape as `probability_level.py`'s existing `ProbabilityLevel` Literal —
  `"gem"` (today's only path, default, no behaviour change for existing
  callers) vs. `"risk_ue_lm1"`. `run_scenario` dispatches to either
  today's `evaluate_damage_batch` (fragility-curve lookup against PGA/SA)
  or a new equivalent that reads `risk_ue_class`/`vi_star` and computes
  `μD` per §1's formula against whatever `I` source §3 settles on.
- The API/frontend threading is the same shape `probability_level`
  already established (CLI flag, API field, frontend selector) — no new
  architectural pattern needed there either.

**The hard parts are §2's real numbers and §3's hazard-chain choice, not
the plumbing.** A backfill for the new columns would follow the same
`backfill.py` pattern already used twice.

## 6. Recommended sequencing, if this is pursued

1. Resolve §3 (GMICE vs. IPE) first — it's the architectural fork
   everything else hangs off, and is answerable with a scoped literature
   check, not blocked on UPM.
2. Get real `Vi*`/`ΔVm` numbers, ideally the Lorca-recalibrated ones —
   this is what `questions-for-upm.md` #1(b) now asks for; the generic
   pan-European table is a fallback if UPM can't share the Lorca-specific
   one, but would make any comparison against MERISUR's own output less
   apples-to-apples (see §2 item 3).
3. Decide the 5→4 damage-grade mapping (§4) as an explicit, documented
   choice — small effort, but a real modeling decision, not a formality.
4. Implement per §5's shape: parallel classifier + parallel damage-model
   path, additive to the existing schema and dispatch pattern.

None of this is started — this document is the scoping pass the user
asked for, not a plan to execute yet.

## Sources

- Lagomarsino, S. & Giovinazzi, S. (2006), *Macroseismic and mechanical
  models for the vulnerability and damage assessment of current
  buildings*, Bulletin of Earthquake Engineering, [Springer](https://link.springer.com/article/10.1007/s10518-006-9024-z) — primary
  source for the μD formula (§1), reached only via secondary citations,
  not the full text.
- Giovinazzi, S. & Lagomarsino, S. (2004), *A macroseismic method for the
  vulnerability assessment of buildings*, 13th World Conference on
  Earthquake Engineering — the original LM1 formulation; full text not
  reachable (paywalled/blocked on every attempt here).
- Worden, C.B. et al. (2012), ground-motion-to-intensity conversion —
  cited as precedent for the GMICE approach in §3; not independently
  verified against the original paper here, cited secondhand.
- The two Lorca-specific vulnerability papers already logged in
  `merisur.md` §4.5 and `validation-lorca-2011.md` §11.2.
