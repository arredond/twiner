"""retaxonomy: re-deriving stale exposure parts from their buildings parts."""

from __future__ import annotations

import pandas as pd
from exposure.retaxonomy import retaxonomy
from exposure.risk_ue_classes import RISK_UE_SOURCE
from exposure.taxonomy import TAXONOMY_SOURCE


def _write_parts(parts, code, years, source, risk_ue_source=None):
    ids = [f"{code}-{i}" for i in range(len(years))]
    pd.DataFrame(
        {
            "building_id": ids,
            "construction_year": years,
            "floors": [2.0] * len(years),
            "municipality_code": [code] * len(years),
        }
    ).to_parquet(parts / f"{code}.buildings.parquet")
    # A stale part: everything in v1's (reinforced) masonry class.
    exposure = pd.DataFrame(
        {
            "building_id": ids,
            "taxonomy_class": ["MR_LWAL-DUL"] * len(years),
            "height_class": [2] * len(years),
            "taxonomy_source": [source] * len(years),
        }
    )
    if risk_ue_source is not None:
        exposure["risk_ue_source"] = risk_ue_source
    exposure.to_parquet(parts / f"{code}.exposure.parquet")


def test_stale_parts_are_rederived_and_recombined(tmp_path):
    parts = tmp_path / "parts"
    parts.mkdir()
    _write_parts(parts, "30024", [1900.0, None, 1955.0, 1990.0], "heuristic_v1")
    out = tmp_path / "exposure.parquet"

    n_parts, n_buildings = retaxonomy(parts, out)

    assert (n_parts, n_buildings) == (1, 4)
    combined = pd.read_parquet(out)
    assert combined["taxonomy_class"].tolist() == [
        "MUR-STRUB_LWAL-DNO",
        "MUR-STRUB_LWAL-DNO",
        "MUR_LWAL-DNO",
        "CR_LDUAL-DUL",
    ]
    assert (combined["taxonomy_source"] == TAXONOMY_SOURCE).all()
    assert not list(parts.glob("*.tmp"))


def test_current_parts_are_left_alone_unless_forced(tmp_path):
    parts = tmp_path / "parts"
    parts.mkdir()
    _write_parts(parts, "20069", [1900.0], TAXONOMY_SOURCE, RISK_UE_SOURCE)
    out = tmp_path / "exposure.parquet"

    assert retaxonomy(parts, out) == (0, 0)
    # Untouched: still the (deliberately wrong) class it was written with.
    assert pd.read_parquet(out)["taxonomy_class"].tolist() == ["MR_LWAL-DUL"]
    assert retaxonomy(parts, out, force=True) == (1, 1)
    assert pd.read_parquet(out)["taxonomy_class"].tolist() == ["MUR-STRUB_LWAL-DNO"]


def test_a_part_missing_a_newer_scheme_is_rederived(tmp_path):
    # GEM classes current, but no RISK-UE columns yet (ADR-0035).
    parts = tmp_path / "parts"
    parts.mkdir()
    _write_parts(parts, "30024", [1990.0], TAXONOMY_SOURCE)
    assert retaxonomy(parts, tmp_path / "exposure.parquet") == (1, 1)
    row = pd.read_parquet(tmp_path / "exposure.parquet").iloc[0]
    # Lorca: NCSE-02 ab 0.12 g, so a 1990 RC building is low code.
    assert (row["risk_ue_class"], row["risk_ue_code_level"]) == ("RC1", "low")
    assert row["ncse02_ab_g"] == 0.12
