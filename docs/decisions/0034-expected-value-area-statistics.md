# ADR-0034: Area statistics as expected values (summed probabilities)

Status: accepted

## Context

Every municipality and census-section figure counted each building once,
in its **reported** damage state: the most likely state, or the 85th
percentile at "very low" probability (MERISUR's probability levels,
ADR-0011). That throws away most of the damage distribution.

At "low" probability, the default model put almost every building of
Lorca's town in Slight and none in Moderate, even when many had a 30–40%
chance of Moderate. The town total looked like "no moderate damage",
against 2,346 observed (docs/validation-lorca-2011.md §14). Population,
cost, debris and shoring inherited the same bias.

## Decision

**Area figures are expected values.** `impact.ImpactCounter` sums, per
census section and damage state, each building's *probability* of being in
that state:

- buildings Σp;
- dwellings Σp·dwellings;
- built area Σp·area.

Every derived figure follows from those sums: affected, vulnerable and
displaced residents, cost, debris, trucks and shoring. A building that is
60% Slight and 40% Moderate adds 0.6 and 0.4. Scenario totals follow the
same rule: `n_damaged` is Σ(1 − P(None)).

**Individual buildings are unchanged.** Each building still gets one
state, chosen by MERISUR's probability levels, for the map, popups, debris
envelopes and facilities.

**The reported-state counts stay available**: `counts_reported` per area,
and `n_damaged_reported` per scenario. This keeps the MERISUR reading of
the levels. With expected values, "low" and "very low" give *identical*
area figures, since they share the same +1σ ground motion and differ only
in which state each building reports. The user chose to keep MERISUR's
levels as they are for now, rather than redefine "very low".

**Affected threshold.** With probabilities, almost every evaluated area
has some tiny expected damage. An area counts as affected (full figures,
listed in `section_stats`, coloured on the map) when it has at least 0.5
expected damaged buildings, or any building *reported* damaged. Below
that, it is reported as undamaged with zero counts, as before
(`AFFECTED_MIN_EXPECTED_BUILDINGS`). That keeps the frontend's
`n_damaged > 0` logic intact. Scenario totals still include everything.

`counts` values are floats (2 decimals); `n_damaged` too. The frontend
already formats them with rounding. `API_VERSION` 8.

**Validation script**: `python -m scenario.validate_lorca` runs Lorca 2011
through every damage method and probability level, and compares expected
and reported counts in the town against the inspection. The town is INE
census district 01; see validation-lorca-2011.md §14.

## Alternatives considered

- **Expected values everywhere, including per building.** The map needs
  one colour per building, and the MERISUR levels are defined per
  building. Rejected.
- **Keep "very low" area figures at the 85th percentile.** It keeps the
  level pessimistic in aggregates, but mixes two counting rules in one
  response. Kept available through `counts_reported` instead.
- **Redefine "very low" as +2σ.** It would make all three levels differ in
  shaking, but departs from MERISUR. Deferred, per the user.
- **Threshold on any non-zero expected damage.** That would mark nearly
  every evaluated municipality as affected and colour it, erasing the
  map's distinction between "evaluated" and "affected" areas.

## Consequences

- Area figures rise wherever a building's distribution leans past its
  reported state, which is most cases at "low": in Lorca's town, moderate
  or worse goes from 0 to about 1,400 (20%), against 2,346 (30%) observed.
- Section and municipality rows can no longer be checked against the
  shipped buildings' states with `counts`; use `counts_reported` for that
  (test_local_api.py does).
- The map's choropleth (mean severity) now uses expected counts, so it can
  differ visibly from the colours of the individual buildings inside it.
  That's intended: the area colour summarises the distribution.
