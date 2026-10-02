# ADR-0035: Precomputed classification schemes; RISK-UE types from Feriche et al. (2012)

Status: accepted

## Context

ADR-0033 added a second vulnerability database, RISK-UE, keyed by RISK-UE
building types rather than GEM taxonomy strings. To use it, the scenario
service **translated** each building's GEM class into a RISK-UE type at
run time (`capacity_spectrum.GEM_TO_RISK_UE`):

| GEM class | RISK-UE type |
|---|---|
| `CR_LDUAL-DUL` | RC1, low code |
| `MUR_LWAL-DNO` | M3.4, pre-code |
| `MUR-STRUB_LWAL-DNO` | M1.1, pre-code |

That had two problems:

- **It throws information away.** The GEM classes are already a lossy
  summary of construction year and floors. Translating them again can only
  lose more: every concrete building became RC1 low code, whatever its
  era or the seismic zone it was built in.
- **It isn't modular.** One project goal is that a building is classified
  once, in every scheme we support, and the user picks the models to run
  against (with sensible defaults). A translation hard-wires one
  taxonomy as the source of every other.

Does RISK-UE need attributes we don't have? Its types are defined by
material, structural system and floor type, which Catastro doesn't
record. But **Feriche et al. (2012)**, writing on Lorca 2011 (*Física de
la Tierra* 24, 255–287), give a building typology matrix (their Table 5)
that assigns a RISK-UE type from the **cadastral construction year**,
checked against Lorca's damage inspections, and a seismic **code level**
by construction period (Table 2). The only missing input was the seismic
zone, which the Spanish seismic code NCSE-02 publishes per municipality
(Annex 1: basic acceleration $a_b$, for every municipality with
$a_b \ge 0.04$ g).

## Decision

**1. Classification schemes, precomputed per building.** A scheme assigns
each building a class in one taxonomy from its own attributes. The
exposure pipeline (`pipelines/exposure/.../classification.py`) computes
every scheme for every building and stores it in the exposure parts and
`exposure.parquet`, each with its own version column:

| Scheme | Taxonomy | Columns | Version column |
|---|---|---|---|
| `gem_heuristic` | `gem` | `taxonomy_class`, `height_class` | `taxonomy_source` (`heuristic_v2`) |
| `risk_ue_feriche2012` | `risk_ue` | `risk_ue_class`, `risk_ue_code_level`, `risk_ue_height` | `risk_ue_source` (`feriche2012_v1`) |

plus the site attribute `ncse02_ab_g` (NaN below 0.04 g). `retaxonomy_cli`
recomputes any part where any scheme's version column is missing or out
of date.

**2. Schemes are a third choice, next to model and database.**
`services/scenario/.../methods.py` declares each scheme (taxonomy, the
attributes it requires, method, reference, and the SQL expression giving
its class). A vulnerability database declares the taxonomy it is keyed
by. A scenario's `DamageMethod` is now (model, database, classification);
it is valid when the database provides what the model needs **and** the
scheme classifies into the database's taxonomy. `classification` is an
optional parameter on both scenario routes; omitted, it defaults to the
database's taxonomy's default scheme. The engine selects
`{scheme.class_sql} AS vulnerability_class` and every damage model reads
that column. Nothing translates one taxonomy into another any more.

**3. The RISK-UE scheme: Feriche et al.'s matrix, applied nationally.**

| Construction year | Type |
|---|---|
| ≤ 1945, or unknown | M3.1 |
| 1946–1959 | M3.4 |
| 1960–1996 | RC1 |
| 1997–2004 | RC3.2 |
| ≥ 2005 | RC3.1 |

Code level: masonry always pre-code; concrete pre-code before 1970, low
1970–1996, moderate from 1997; and **pre-code wherever the municipality's
NCSE-02 $a_b$ is below 0.04 g**, whatever the year. Height band: L 1–2,
M 3–5, H 6+ storeys. The matrix was built for Lorca; we apply it to all
of Spain and say so in the public docs (twinQUAKE §5, a caution box).

**4. NCSE-02 Annex 1, parsed once and committed.** `exposure.ncse02`
parses the BOE PDF (`pdftotext -raw`) and matches its 2,615 entries
(2002 names, by province) to today's INE codes: 2,535 by exact name, 25
fuzzy, 55 by a hand-checked alias table (`ncse02_data/aliases.csv`:
renamed, merged, and localities inside a municipality, such as Llert in
Valle de Bardají). The outputs, `annex1.csv` and `ab_by_municipality.csv`
(2,613 municipalities), are committed so they can be reused without the
PDF.

**5. Missing curves use the nearest available one.** RISK-UE WP4
tabulates capacity curves for only some (type, code level) pairs.
`risk_ue_2003_capacity.csv` now holds M1.2, M3.4 and RC1 pre-code (Table
3.1-1, UNIGE) and RC1, RC3.1 and RC3.2 low code (Table 3.1-2, AUTh).
`risk_ue_2003_substitutions.csv` maps the rest, with a reason per row:

| Assigned | Uses | Why |
|---|---|---|
| M3.1 pre | M1.2 pre | No M3.1 curve; same Level I index V\* = 0.74 (WP4 Table 2.2) |
| RC3.1 pre / moderate | RC3.1 low | Only tabulated at low code |
| RC3.2 pre / moderate | RC3.2 low | Only tabulated at low code |

M1.2 L also has an AUTh row in WP4; we use UNIGE's, so all masonry
comes from one partner and method. The M1.1 rows are gone (no scheme
assigns M1.1).

**6. API_VERSION 9.** `damage_method` in the response and `GET /methods`
gain fields. Default-method scenario ids hash no method, so only the
version bump changes them.

## Alternatives considered

- **Keep translating GEM → RISK-UE, but finer.** Still lossy, and still
  makes GEM the source of every other taxonomy. Rejected for the
  modularity reason above.
- **Compute classes at scenario time from raw attributes.** Possible (the
  rules are cheap), but every scheme would then have to be reimplemented in
  the service and evaluated per request, and the classes couldn't be
  inspected, tiled or exported. Precomputing costs ~1 minute
  (`retaxonomy_cli`, 8,141 parts, 13.0M buildings) and a few columns.
- **Leave RISK-UE out until we have structural attributes.** Feriche et
  al.'s matrix is published, Spanish, and validated on the one Spanish
  event we compare against; it is a better default than nothing, provided
  its Lorca origin is stated.
- **Skip the NCSE-02 code-level rule.** Without it every 1970+ concrete
  building would be low or moderate code, including in the 48% of
  buildings in municipalities where NCSE-02 doesn't require seismic design.

## Consequences

- **Results changed only for `risk_ue`.** The GEM columns are untouched
  (all 8,141 exposure parts compared row by row against a backup). Lorca
  town at "low": capacity spectrum + RISK-UE goes from 77% any damage /
  65% moderate+ to 81% / 66% (docs/validation-lorca-2011.md §15).
- **The cloud needs the new exposure.parquet** before this code is
  deployed: `risk_ue` runs read `risk_ue_*` columns and fail on the old
  file. Re-upload it and bump `TWINER_DATA_VERSION`. Default runs work
  either way.
- **Adding a scheme** is: a function in the pipeline, an entry in
  `classification.SCHEMES` and `methods.CLASSIFICATION_SCHEMES`, a
  retaxonomy run. Adding a database keyed by an existing taxonomy needs
  no pipeline change.
- **Known biases:** moderate-code RC3.x (every 1997+ building in a
  seismic municipality) runs on low-code curves, so it is likely
  over-vulnerable; M1.2 is weaker than GEM's rubble stone. Both are in the
  public Damage models page.
- **Not done:** a classification choice in the frontend (each database
  uses its default scheme), and per-era seismic zoning (the 0.04 g rule
  uses today's NCSE-02 map for buildings of every era).
