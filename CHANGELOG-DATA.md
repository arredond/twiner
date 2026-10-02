# Data version changelog

`DATA_VERSION` (`infra/stacks/twiner_stack.py`, deployed as
`TWINER_DATA_VERSION`) is part of every scenario_id, so bumping it
invalidates every cached scenario result (ADR-0018). Bump it, and
`cdk deploy`, whenever anything the scenario or tiles functions read
from the data bucket is re-uploaded: exposure, buildings, fragility,
faults, census, infrastructure parquet.

**Format**: CalVer `YYYY.0M.0D.N`, the upload date plus a counter for
that day starting at 1. Add an entry here with every bump, newest first,
saying what was re-uploaded. `services/scenario/tests/test_versions.py`
checks the newest entry matches `DATA_VERSION`.

## 2026.10.02.1

- `exposure/exposure.parquet`: adds the RISK-UE classification scheme
  (`risk_ue_class`, `risk_ue_code_level`, `risk_ue_height`,
  `risk_ue_source`) and `ncse02_ab_g` (ADR-0035). GEM columns unchanged.
- Switched from date labels to CalVer.

## Before CalVer

| Version | Change |
|---|---|
| `2026-10-01-taxonomy-v2` | Taxonomy v2: unreinforced masonry classes (ADR-0032) |
| `2026-09-29-infra` | Critical infrastructure (ADR-0025) |
| `2026-09-29` | Census sections and impact columns (ADR-0024) |
| `2026-09-24` | First versioned data, with the result cache (ADR-0018) |
