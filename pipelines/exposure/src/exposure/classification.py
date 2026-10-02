"""Vulnerability classification schemes, computed for every building.

ADR-0035. A scheme assigns each building a class in one taxonomy (the set
of classes a vulnerability database is keyed by), from the building's own
attributes. Every scheme is computed once, offline, and stored per
`building_id` in the exposure parts (`<code>.exposure.parquet`) and the
combined exposure.parquet. At scenario time the service reads the class
of whichever scheme the user picked (services/scenario methods.py, which
declares the same schemes), so adding a scheme or a database never means
translating one taxonomy into another.

Each scheme declares the attributes it requires, the first step towards
enabling schemes per country by the data available there.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from .ncse02 import load_ab_by_municipality
from .risk_ue_classes import RISK_UE_SOURCE, assign_risk_ue
from .taxonomy import TAXONOMY_SOURCE, assign_taxonomy


@dataclass(frozen=True)
class ClassificationScheme:
    id: str
    taxonomy: str  # "gem" or "risk_ue": what a vulnerability database is keyed by
    version: str
    source_column: str  # where each building records the version that classified it
    requires: tuple[str, ...]
    reference: str


SCHEMES = (
    ClassificationScheme(
        id="gem_heuristic",
        taxonomy="gem",
        version=TAXONOMY_SOURCE,
        source_column="taxonomy_source",
        requires=("construction_year", "floors"),
        reference="TWIN-ER heuristic (docs/TAXONOMY.md, ADR-0012, ADR-0032)",
    ),
    ClassificationScheme(
        id="risk_ue_feriche2012",
        taxonomy="risk_ue",
        version=RISK_UE_SOURCE,
        source_column="risk_ue_source",
        requires=("construction_year", "floors", "ncse02_ab_g"),
        reference="Feriche et al. (2012), Física de la Tierra 24, Tables 2 and 5",
    ),
)


def ncse02_ab(municipality_codes: pd.Series) -> pd.Series:
    """Each building's municipality's NCSE-02 basic acceleration (g), NaN
    where it's below 0.04 g (not listed in NCSE-02's Annex 1)."""
    ab = load_ab_by_municipality().set_index("ine_code")["ab_g"]
    return municipality_codes.astype(str).map(ab)


def classify(buildings: pd.DataFrame) -> pd.DataFrame:
    """The exposure part for these buildings: every scheme's classes.
    `buildings` needs building_id, construction_year, floors and
    municipality_code."""
    gem = [
        assign_taxonomy(year, floors)
        for year, floors in zip(buildings["construction_year"], buildings["floors"], strict=True)
    ]
    ab = ncse02_ab(buildings["municipality_code"])
    risk_ue = assign_risk_ue(buildings["construction_year"], buildings["floors"], ab)
    return pd.DataFrame(
        {
            "building_id": buildings["building_id"].to_numpy(),
            # gem_heuristic
            "taxonomy_class": [g[0] for g in gem],
            "height_class": [g[1] for g in gem],
            "taxonomy_source": TAXONOMY_SOURCE,
            # risk_ue_feriche2012
            "risk_ue_class": risk_ue["risk_ue_class"].to_numpy(),
            "risk_ue_code_level": risk_ue["risk_ue_code_level"].to_numpy(),
            "risk_ue_height": risk_ue["risk_ue_height"].to_numpy(),
            "risk_ue_source": RISK_UE_SOURCE,
            # Site attribute shared by schemes (NaN: below 0.04 g).
            "ncse02_ab_g": ab.to_numpy(),
        }
    )


def is_current(exposure: pd.DataFrame) -> bool:
    """Whether every scheme's column exists and carries its current version."""
    return bool(len(exposure)) and all(
        s.source_column in exposure.columns and (exposure[s.source_column] == s.version).all()
        for s in SCHEMES
    )
