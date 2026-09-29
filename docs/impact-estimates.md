# Post-scenario impact estimates

What the impact sidebar and the municipality/census-section popups report
after a scenario runs, and exactly how each figure is computed. The
architecture (census sections as a spatial level, where the numbers are
computed, how they reach the frontend) is in
[ADR-0024](decisions/0024-census-sections-and-impact-estimates.md); this
document is about the numbers themselves.

**These are rough, documented placeholders, not a calibrated loss model.**
Every parameter below is either a round-number assumption or a generic
(US) HAZUS default mapped onto our two building typologies. None of it has
been validated against observed Spanish losses. Treat the figures as
orders of magnitude for comparing places and scenarios, not as predictions.
The constants live in `services/scenario/src/scenario/impact.py`, and the
sidebar tooltips (`apps/web/src/impactFormat.ts`) quote them; change both
together.

## Inputs

For every building a scenario evaluates, the engine already knows its
predicted damage state (None / Slight / Moderate / Extensive / Complete,
damage.py). Three per-building attributes are added
(`pipelines/exposure/.../census_sections.py`):

| Attribute | Source |
|---|---|
| `census_section_code` | The INE 2025 census section containing the building's centroid, or the nearest section in its own municipality if none contains it. |
| `num_dwellings` | Cadastral dwelling count (Catastro INSPIRE `numberOfDwellings`, or the Foral equivalent). |
| `built_area_m2` | Cadastral gross floor area over all storeys (Catastro `officialArea`). The Basque/Navarra Foral sources publish none, so there it's the footprint area (EPSG:3035) × storeys. |

Per census section, INE's **Censo Anual de Población, 1 January 2025**
gives:
- the resident population;
- the residents aged under 15;
- the residents aged 65 and over.

See [DATA-SOURCES.md](../DATA-SOURCES.md).

As a scenario's buildings stream through, the backend sums three things
per section and damage state: buildings, dwellings and built area.
Everything below is derived from those sums. A municipality's figures are
the sums of its sections' figures; percentages are recomputed from the
sums, never averaged.

## Figures

"Affected" means any damage state other than None: the same definition the
map's choropleth has always used. "Displaced" means Extensive or Complete.

### Buildings affected (%)

Affected buildings ÷ **all** buildings in the area (not just the ones the
scenario evaluated).

### Population, affected population (%)

INE publishes how many people live in a section, not in which building.
The section's residents are spread over its buildings **in proportion to
their dwellings**:

    affected_population(section) = population × dwellings in affected buildings
                                              ÷ all dwellings in the section

`displaced_population` is the same with Extensive + Complete dwellings.

This spreads every resident across every cadastral dwelling. That includes
second homes and empty dwellings, which is why the national figure is 1.92
residents per cadastral dwelling (49.1M residents, 25.6M dwellings), below
the ~2.5 people per occupied household. In coastal and rural sections with
many second homes, occupancy is therefore spread thinner than it really
is.

Fallbacks:
- **Section with no dwellings:** 10 populated sections nationwide (8,091
  residents) have no dwellings recorded on any of their buildings. There,
  residents are spread by building count instead.
- **Building with no section:** such a building (only possible with a
  buildings file built before sections existed) still counts toward its
  municipality's buildings, cost and debris. It contributes no population.

### Vulnerable/dependent population affected (%)

"Vulnerable/dependent" means residents **under 15 or 65 and over**: the
dependent age groups of Eurostat's age-dependency ratio. INE's own
dependency ratio uses under 16, which the census's 5-year age groups can't
express.

    affected_vulnerable(section) = affected_population × (under-15 + 65-plus) ÷ population

This assumes each section's age mix applies to every building in it.

### Material cost (M€)

    cost = Σ over damage states: built area × €1,000/m² × damage ratio

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Damage ratio (repair cost ÷ replacement cost) | 2% | 10% | 43% | 100% |

- **Damage ratios:** HAZUS-MH 2.1 Technical Manual, Tables 15.2–15.4. These
  are the structural, acceleration-sensitive nonstructural and
  drift-sensitive nonstructural repair-cost ratios, summed. The residential
  classes give RES1 (single family) 2.0 / 10.0 / 44.7 / 100% and RES3
  (multi-family) 2.0 / 10.0 / 41.3 / 100%. Extensive is their average.
- **€1,000/m² replacement cost:** a round-number assumption for demolition
  plus reconstruction of an average Spanish building. It isn't taken from a
  published Spanish reference. Building costs vary a lot by region and
  building type, so this is the single most influential parameter to
  replace with a real value.
- **Contents are excluded.** So are indirect losses, and the rise in costs
  after a disaster.

### Debris (t)

    debris = Σ over damage states: built area × 1.1 t/m² × debris fraction

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Debris fraction (share of building weight) | 2% | 10% | 38% | 100% |

These come from HAZUS-MH 2.1 Tables 12.1–12.3 (unit weights by element,
and debris as a percentage of that weight per damage state). They're
evaluated for the two HAZUS model building types closest to our two
typologies, and assume structural and nonstructural damage states are
equal:

| HAZUS type | Our typology | Weight | Slight | Moderate | Extensive |
|---|---|---|---|---|---|
| C3 (concrete frame, unreinforced masonry infill) | `CR_LDUAL-DUL` | 1.17 t/m² | 0.9% | 7.9% | 36.8% |
| URML/URMM (unreinforced masonry) | `MR_LWAL-DUL`, `MUR-STRUB_LWAL-DNO` | 0.88 t/m² | 2.2% | 12.4% | 39.1% |

The table above uses 1.1 t/m² and rounded fractions between the two, one
value for all buildings. A per-typology split is a cheap follow-up
(exposure.parquet already has each building's typology).

HAZUS weights are US short tons per 1,000 ft². They're converted here to
metric tonnes per m²: × 0.9072 ÷ 92.9.

This is a weight estimate. It is separate from ADR-0010's debris
*envelopes* (the 1–4 m rings on the map), which show where debris could
land, not how much there is.

### Truck rotations

    truck_rotations = ⌈debris ÷ 20 t⌉

20 t is a typical payload for a 3–4 axle rigid dump truck. The estimate
counts trips only: no volume limits (rubble's bulk density can fill a
truck's box before its weight limit), no haul distance, no sorting.

### Puntales (shoring props)

    props = Σ over damage states: built area × share to shore × 1 prop/m²

| | Slight | Moderate | Extensive | Complete |
|---|---|---|---|---|
| Share of built area needing shoring | 0% | 5% | 20% | 0% |

These values are **pure assumptions**; no source was found for them.
- Emergency shoring of slabs typically places props at roughly 1 m
  spacing.
- Moderate damage may need local propping, Extensive damage more.
- Complete damage is demolished rather than shored, hence 0%.

Replace these values with figures from Spanish emergency-response practice
(e.g. the Lorca 2011 records, via UPM) if they become available.

## Reference run

Both runs are manual scenarios at Lorca's 2011 epicentre (37.699, -1.673),
computed locally on the national dataset on 2026-09-29.

- **Mw 5.2, "very_low":** Lorca has 13,340 of 27,884 buildings affected
  (47.8%). That's 72,194 of 98,613 residents (73.2%), including 22,426
  vulnerable residents, and 0 displaced (no building reaches Extensive).
  Material cost €214.6M, debris 236,027 t, 11,802 truck rotations, 31,389
  props.
- **Mw 6.5, "low":** Lorca has 17,555 buildings affected. That's 84,135
  residents, with 8,791 displaced. Material cost €1,092M, debris
  1,201,254 t.

These figures haven't been compared with Lorca 2011's recorded losses,
displacement or debris-removal volumes. That comparison (records
obtainable via UPM, see docs/questions-for-upm.md) is the natural first
calibration step.

## Known limitations / follow-ups

- **One weight and one cost for all buildings.** Splitting by typology and
  use (industrial sheds weigh and cost far less per m² than housing) is
  the obvious next refinement.
- **Only the resident (night-time) population.** There's no daytime or
  occupancy model: MERISUR's "dynamic occupancy" isn't implemented.
- **No uncertainty band.** Every figure uses the damage state reported for
  the chosen probability level, not the full distribution of damage-state
  probabilities.
