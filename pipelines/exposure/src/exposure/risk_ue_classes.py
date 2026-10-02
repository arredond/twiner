"""RISK-UE building types from cadastral attributes: Feriche et al. (2012).

Feriche, M., Vidal, F., Alguacil, G., Navarro, M. & Aranda, C. (2012),
*Vulnerabilidad y daño en el terremoto de Lorca de 2011*, Física de la
Tierra 24, 255-287. Their building typology matrix for Lorca (Table 5)
assigns a RISK-UE type from the cadastral construction year (and floors),
checked against Lorca's 2011 inspections. Their Table 2 gives the seismic
code level per construction period, following the Spanish codes' history.

**Calibrated on Lorca, applied nationally** (ADR-0035): it assumes Lorca's
construction history (materials and systems per era) is typical of Spain.
That is plausible for Mediterranean Spain and less so elsewhere.

Rules (version `feriche2012_v1`):

| Construction year | RISK-UE type | Description (Feriche et al., Table 5) |
|---|---|---|
| <= 1945, or unknown | M3.1 | Masonry / brick, timber floors |
| 1946-1959 | M3.4 | Brick masonry with RC floors |
| 1960-1996 | RC1 | RC frames (1960-77 deep beams; 1977-96 flat beams, waffle slabs) |
| 1997-2004 | RC3.2 | RC frames, flat beams / waffle slabs (NCSE-94) |
| >= 2005 | RC3.1 | RC frames, flat beams / waffle slabs, steel (NCSE-02) |

Code level (Table 2): masonry is always pre-code; RC is pre-code before
1970 (MV-101 and earlier), low 1970-1996 (PGS-1, PDS-1), moderate from
1997 (NCSE-94, NCSE-02). Where NCSE-02 gives ab < 0.04 g (the municipality
isn't in its Annex 1), the code doesn't require seismic design, so the
building is pre-code whatever its year. The 0.04 g rule is NCSE-02's and
is applied to every era, a simplification: earlier codes zoned Spain
differently.

Height band (RISK-UE typology matrix, WP4 Table 1.1): L 1-2 storeys, M
3-5, H 6+. Unknown floors count as low-rise, as in taxonomy.py.

An unknown construction year gets the oldest, most vulnerable type (M3.1),
as taxonomy.py's GEM classes do.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

RISK_UE_SOURCE = "feriche2012_v1"

# (first year of the period, type), in order; a year falls in the last
# period whose start it reaches.
TYPE_BY_YEAR = ((1946, "M3.4"), (1960, "RC1"), (1997, "RC3.2"), (2005, "RC3.1"))
OLDEST_TYPE = "M3.1"
MASONRY_TYPES = ("M3.1", "M3.4")
# RC code level by year, for municipalities where NCSE-02 requires design.
CODE_LOW_FROM, CODE_MODERATE_FROM = 1970, 1997
NCSE02_MIN_AB_G = 0.04


def assign_risk_ue(
    construction_year: pd.Series, floors: pd.Series, ab_g: pd.Series
) -> pd.DataFrame:
    """risk_ue_class, risk_ue_code_level and risk_ue_height per building.
    `ab_g`: the municipality's NCSE-02 basic acceleration, NaN if < 0.04 g."""
    year = pd.to_numeric(construction_year, errors="coerce")
    known = year.notna()
    building_type = np.full(len(year), OLDEST_TYPE, dtype=object)
    for start, kind in TYPE_BY_YEAR:
        building_type[(known & (year >= start)).to_numpy()] = kind

    seismic_area = (pd.to_numeric(ab_g, errors="coerce") >= NCSE02_MIN_AB_G).to_numpy()
    code = np.full(len(year), "pre", dtype=object)
    rc = ~np.isin(building_type, MASONRY_TYPES)
    y = year.fillna(0).to_numpy()
    code[rc & seismic_area & (y >= CODE_LOW_FROM)] = "low"
    code[rc & seismic_area & (y >= CODE_MODERATE_FROM)] = "moderate"

    storeys = pd.to_numeric(floors, errors="coerce").fillna(1).to_numpy()
    height = np.where(storeys >= 6, "H", np.where(storeys >= 3, "M", "L"))
    return pd.DataFrame(
        {"risk_ue_class": building_type, "risk_ue_code_level": code, "risk_ue_height": height},
        index=construction_year.index,
    )
