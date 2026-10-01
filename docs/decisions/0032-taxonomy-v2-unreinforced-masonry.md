# ADR-0032: Taxonomy v2: unreinforced masonry class, and re-deriving stale parts

Status: accepted

## Context

While writing the public docs (ADR-0031), two problems turned up in how
buildings get their vulnerability class.

1. **The 1940 rule never reached most of Spain.** ADR-0012 (16 Sep 2026)
   added `MUR-STRUB_LWAL-DNO` for buildings before 1940 or with an unknown
   year. The region crawl resumes by skipping municipalities whose parts
   already exist, and ADR-0012 didn't change the `taxonomy_source` label
   (`heuristic_v1`). So every part crawled before it kept the old classes
   under the same label: Murcia and Andalucía (Lorca included) and most
   other provinces. Nationally only 95,447 buildings were rubble-stone
   masonry. About 1.15M pre-1940 and 1.71M unknown-year buildings were
   classed as `MR_LWAL-DUL` instead.
2. **`MR_LWAL-DUL` is reinforced masonry.** The project documented it as
   "generic unreinforced masonry", but in the GEM taxonomy `MR` is
   *reinforced* masonry; `MUR` is unreinforced. That is why
   docs/validation-lorca-2011.md §10.1 found it the least vulnerable masonry
   class. Spanish masonry from 1940 to 1969 is overwhelmingly unreinforced.
   Martins & Silva publish the class that matches the original intent,
   `MUR_LWAL-DNO`: generic unreinforced masonry, unit material unspecified,
   non-ductile.

## Decision

- **Heuristic v2** (`taxonomy.TAXONOMY_SOURCE = "heuristic_v2"`):
  - ≥ 1970: `CR_LDUAL-DUL`
  - 1940–1969: `MUR_LWAL-DNO` (was `MR_LWAL-DUL`)
  - before 1940 or unknown: `MUR-STRUB_LWAL-DNO`

  `pipelines/fragility` vendors `MUR_LWAL-DNO` H1–H5 in place of
  `MR_LWAL-DUL`. Both masonry classes stop at H5 upstream, and
  `fragility_lookup`'s nearest-height fallback covers taller buildings.
  Note that `MUR_LWAL-DNO` H1 is indexed by SA(0.3 s), not PGA.
- **`exposure.retaxonomy_cli`** re-derives every part whose
  `taxonomy_source` isn't current, from the `construction_year`/`floors`
  already in its buildings part, then recombines `exposure.parquet`. It
  writes each file to a temporary name and renames it into place, so it
  can be re-run safely. It takes 40 s nationally. Rule: **bump
  `TAXONOMY_SOURCE` whenever `assign_taxonomy` changes, then run it.**
- Applied to the national data on 2026-10-01. The old files are kept in
  `data/exposure/backup-taxonomy-heuristic_v1-20261001/` (parts,
  `exposure.parquet` and the old `fragility.parquet`).

`MUR-CL99_LWAL-DNO` (unreinforced fired-clay-unit masonry) was considered.
Its curves are within a few percent of `MUR_LWAL-DNO`, but picking it would
assert a unit material Catastro doesn't record.

## Consequences

- National classes: 7,381,534 concrete, 2,678,450 generic unreinforced
  masonry, 2,953,201 rubble-stone masonry. Lorca: 15,634 / 6,380 / 5,870.
- Damage rises substantially wherever there is old masonry. For Lorca 2011
  (Mw 5.2), "very low" goes from 2,344 Moderate to 4,745 Moderate + 1,075
  Extensive. "Low" and "very low" now bracket the 2,346 buildings observed
  at EMS-98 grade 3+. See docs/validation-lorca-2011.md §13.
- **Deploying** needs `exposure.parquet` and `fragility.parquet` uploaded
  to S3 (docs/deploy-aws-setup.md), a `DATA_VERSION` bump, a deploy, and
  `bin/warm-scenario-cache`. Cached results computed with the old classes
  must not be served.
- Any local server already running holds the old tables in memory and needs
  a restart.
