# API version changelog

`API_VERSION` (`services/scenario/src/scenario/scenario_id.py`) is part of
every scenario_id, so bumping it invalidates every cached scenario result
(ADR-0018). Bump it whenever a change to rupture, ground-motion, damage
or response logic could change any result or the response shape. Not for
docs, frontend or infra changes.

**Format**: CalVer `YYYY.0M.0D.N`, the release date plus a counter for
that day starting at 1 (`2026.10.02.1`, then `2026.10.02.2`). Add an
entry here with every bump, newest first.
`services/scenario/tests/test_versions.py` checks the newest entry
matches `API_VERSION`.

## 2026.10.02.1

- Scenario ids always hash the damage method, the default included, so
  every model / database / classification combination is cached on its
  own.
- Precomputed classification schemes; `damage_method` gains
  `classification`; RISK-UE runs use Feriche et al.'s types instead of a
  translation of the GEM classes (ADR-0035).
- Switched from a counter to CalVer.

## Before CalVer

Plain counters, by the date they were committed:

| Version | Date | Change |
|---|---|---|
| 9 | 2026-10-02 | Classification schemes (ADR-0035). Never deployed; superseded by 2026.10.02.1 |
| 8 | 2026-10-01 | Area figures are expected values (summed probabilities); `counts_reported`, `n_damaged_reported` (ADR-0034) |
| 7 | 2026-10-01 | Response gains `damage_method`; selectable damage model and vulnerability database (ADR-0033) |
| 6 | 2026-09-29 | Response gains `infrastructure_summary`; per-scenario infrastructure and intensity files (ADR-0025) |
| 5 | 2026-09-29 | `municipality_stats` gain census-section impact figures, plus `section_stats.json.gz` (ADR-0024) |
| 4 | 2026-09-25 | Per-building results stored column-oriented (ADR-0023); same values |
| 3 | 2026-09-24 | Streamed evaluation on one ground-motion grid per scenario (ADR-0020); cell values shift slightly |
| 2 | 2026-09-24 | Response drops `buildings`, adds `n_damaged` (ADR-0019) |
| 1 | 2026-09-24 | Content-addressed scenario ids and the result cache (ADR-0018) |
