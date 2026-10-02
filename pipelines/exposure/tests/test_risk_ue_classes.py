"""RISK-UE classes from cadastral attributes (Feriche et al. 2012)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from exposure.risk_ue_classes import assign_risk_ue


def _assign(years, floors=None, ab=0.12):
    n = len(years)
    return assign_risk_ue(
        pd.Series(years, dtype=float),
        pd.Series(floors if floors is not None else [2] * n, dtype=float),
        pd.Series([ab] * n, dtype=float),
    )


def test_type_and_code_level_by_construction_year():
    out = _assign([1900, 1945, 1946, 1959, 1960, 1969, 1970, 1996, 1997, 2004, 2005, None])
    assert out["risk_ue_class"].tolist() == [
        "M3.1", "M3.1", "M3.4", "M3.4", "RC1", "RC1", "RC1", "RC1", "RC3.2", "RC3.2", "RC3.1", "M3.1",
    ]  # fmt: skip
    assert out["risk_ue_code_level"].tolist() == [
        "pre", "pre", "pre", "pre", "pre", "pre", "low", "low", "moderate", "moderate", "moderate", "pre",
    ]  # fmt: skip


def test_no_seismic_design_below_ncse02_threshold():
    # Not in NCSE-02's Annex 1 (ab < 0.04 g): pre-code whatever the year.
    out = _assign([1980, 2010], ab=np.nan)
    assert out["risk_ue_code_level"].tolist() == ["pre", "pre"]
    assert out["risk_ue_class"].tolist() == ["RC1", "RC3.1"]


def test_height_bands():
    out = _assign([1990] * 6, floors=[1, 2, 3, 5, 6, np.nan])
    assert out["risk_ue_height"].tolist() == ["L", "L", "M", "M", "H", "L"]
