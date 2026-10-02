# NCSE-02 basic seismic acceleration per municipality

Reusable tables of the Spanish seismic building code's design
acceleration, matched to today's INE municipality codes. Built by
`python -m exposure.ncse02 <municipalities.parquet>` (see `../ncse02.py`).

**Source.** Real Decreto 997/2002, *Norma de Construcción Sismorresistente:
parte general y edificación (NCSE-02)*, BOE núm. 244, 11 October 2002,
Annex 1: municipalities with basic seismic acceleration ab ≥ 0.04 g, with
their contribution coefficient K.
[PDF](https://www.boe.es/boe/dias/2002/10/11/pdfs/A35898-35967.pdf).
Legal texts are excluded from copyright in Spain (Ley de Propiedad
Intelectual, art. 13), so these tables can be shared freely.
Municipalities **not** listed have ab < 0.04 g, where NCSE-02 doesn't
require seismic design.

| File | Rows | Contents |
|---|---|---|
| `annex1.csv` | one per Annex 1 entry (2,615) | `province_code`, `ncse02_name` (as printed), `ab_g`, `k`, `ine_code` (today's municipality), `match` (`exact`, `alias`, `fuzzy`) |
| `ab_by_municipality.csv` | one per INE municipality (2,613) | `ine_code`, `ab_g`, `k`, `ncse_names`. A municipality that merged several 2002 ones keeps the highest ab. |
| `aliases.csv` | 55, hand-checked | Annex 1 names that don't match today's municipality by name: `relation` is `renamed`, `merged`, `locality_of` (a locality inside a municipality: its value then applies to the whole municipality) or `name_collision`. Checked on 2026-10-02, the last three `locality_of` rows by the project owner. |

**Matching.** By normalised name within the province: accents stripped,
articles moved to the front ("EJIDO, EL" → "EL EJIDO"), either side of
bilingual names. Then `aliases.csv`, which takes precedence over exact
matches. Then a close fuzzy match (25 entries: spelling variants such as
"BENISANÓ" → "Benissanó", all checked). All 2,615 entries are matched.

**Caveat.** Annex 1 lists a few localities rather than municipalities
(Llert, A Igrexa, A Pedreira). Their value is applied to the whole
municipality they belong to (Valle de Bardají, Pontevedra), which raises
those municipalities from < 0.04 g to 0.04 g.
