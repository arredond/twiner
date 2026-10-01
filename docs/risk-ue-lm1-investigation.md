# Investigation: applying RISK-UE LM1, and multi-methodology vulnerability classes

Status: research only, no code changes. Written in response to
`docs/validation-lorca-2011.md` §11.2 flagging RISK-UE LM1 as the more
likely explanation for the remaining twiner/MERISUR gap at Lorca, and a
request to scope (a) what implementing it would take and (b) whether
buildings could carry multiple vulnerability classifications (one per
methodology) so a scenario can pick which one to run against.

## Update, 2026-10-01: what has changed since this was written

Still not implemented (out of scope of ADR-0033, which added Level II).
But most of this doc's blockers have moved:

- **§2's missing Vi\* table is now available.** RISK-UE's own WP4 report
  (Milutinovic & Trendafiloski 2003, *WP4: Vulnerability of current
  buildings*) is readable at
  `http://www.civil.ist.utl.pt/~mlopes/conteudos/DamageStates/Risk%20UE%20WP04_Vulnerability.pdf`.
  Table 2.2 gives Vmin, V−, V\*, V+ and Vmax per RISK-UE type. Examples
  of V\*: M1.1 0.873, M1.2 0.74, M3.4 0.616, RC1 0.442. Tables 2.4–2.6
  give the behaviour modifiers ΔVm and the regional factor ΔVf. Chapter
  2 gives the μD formula and the beta damage distribution (Eqs. 2-1 to
  2-12; with t = 8 it notes the beta looks very similar to the binomial). The report is © European Commission with a
  no-reproduction notice: cite and copy only the rows used, as
  ADR-0033 did for the capacity curves.
- **§3's blocker (no intensity per site) is solved in principle.**
  ADR-0025 computes EMS-98 intensity per site (Worden et al. 2012, from
  PGV) on the scenario grid. But it **under-estimates Lorca 2011**: 5.7 at
  median and 6.6 at +1σ, against IGN's observed VII. LM1 is very
  sensitive to I: μD rises 1.5–2.5x per intensity degree in the VI–VIII
  range, depending on V. Validating the PGV→intensity conversion against IGN's
  intensity data comes **first**.
- **A Lorca-specific LM1 application exists**: Feriche, Vidal, Alguacil,
  Navarro & Aranda (2012), *Vulnerabilidad y daño en el terremoto de
  Lorca de 2011*, Física de la Tierra 24, 255–287. It assigns
  vulnerability indices to Lorca's building types (from Catastro year and
  height plus inspections) and compares expected against observed EMS-98
  damage. It is the natural calibration reference, and readable at the
  Instituto Andaluz de Geofísica's site.
- **§5's architecture now exists** (ADR-0033, `services/scenario/methods.py`).
  LM1 would be a third damage model, `macroseismic`, which needs a new
  vulnerability data kind (`vulnerability_index`), plus a database
  providing it (`risk_ue`, from WP4 Table 2.2, mapped like ADR-0033's
  capacity curves), and an `EMS-98 intensity` hazard input. §4's
  five-grade (D0–D5) to five-state mapping is still a decision to make.
  One option: D1→Slight, D2→Moderate, D3→Extensive, D4+D5→Complete.

Remaining order: (1) validate intensity against IGN data; (2) vendor WP4
Table 2.2 rows for the three mapped types; (3) decide the grade mapping;
(4) implement the `macroseismic` model against Feriche et al.'s Lorca
results.

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
