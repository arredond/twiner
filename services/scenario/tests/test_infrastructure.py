"""Unit tests for scenario/infrastructure.py (ADR-0025): the intensity
conversion, per-asset evaluation and the intensity bands. The HTTP routes
are covered in test_local_api.py."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest
import shapely
from scenario import infrastructure as infra
from scenario.rupture import from_manual_input

LAT, LON = 37.67, -1.70


def test_mmi_from_pgv_matches_worden_2012():
    # log10(PGV) = 1 >= T1 (0.53): upper segment, 2.89 + 3.16.
    assert infra.mmi_from_pgv(np.array([10.0]))[0] == pytest.approx(6.05)
    # log10(PGV) = 0 < T1: lower segment, C1.
    assert infra.mmi_from_pgv(np.array([1.0]))[0] == pytest.approx(3.78)
    values = infra.mmi_from_pgv(np.logspace(-2, 3, 50))
    assert np.all(np.diff(values) >= 0)
    assert values.min() >= 1.0 and values.max() <= 10.0


@pytest.fixture
def assets_path(tmp_path, monkeypatch):
    path = tmp_path / "infrastructure_sites.parquet"
    pd.DataFrame(
        {
            "asset_id": [10, 11, 12, 13],
            "category": ["health", "bridge", "education", "power"],
            "subtype": ["hospital", "bridge", "school", "substation"],
            "name": ["H", None, "S", None],
            # 12 is ~200km away: in the site box, well below intensity VI.
            "lon": [LON, LON + 0.01, LON, LON],
            "lat": [LAT, LAT, LAT + 1.8, LAT + 0.01],
            "municipality_code": ["30024", "30024", "02003", "30024"],
            "vs30": [800.0, np.nan, 800.0, 800.0],
            "building_id": ["b1", None, "b9", None],
        }
    ).to_parquet(path, index=False)
    monkeypatch.setenv("TWINER_INFRA_SITES_PATH", str(path))
    return path


def _tracked(rows: dict[str, tuple[int, list[float]]]) -> pa.Table:
    """ScenarioSummary.tracked-shaped rows: building_id -> (code, probs)."""
    ids = list(rows)
    return pa.table(
        {
            "building_id": pa.array(ids, pa.string()),
            "damage_state_code": pa.array([rows[i][0] for i in ids], pa.int64()),
            **{
                f"prob_{state}": pa.array([rows[i][1][k] for i in ids], pa.float64())
                for k, state in enumerate(["none", "slight", "moderate", "extensive", "complete"])
            },
        }
    )


def test_evaluate_assets(assets_path):
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    probs = [0.05, 0.15, 0.2, 0.35, 0.25]
    rows = infra.evaluate_assets(rupture, 250.0, 0.0, _tracked({"b1": (3, probs)}))
    assert rows is not None
    by_id = {r["asset_id"]: r for r in rows}
    assert set(by_id) == {10, 11, 13}
    # The facility carries its building's whole distribution, not just the
    # most likely state.
    assert by_id[10]["damage_state_code"] == 3
    assert by_id[10]["damage_probs"] == probs
    assert by_id[11]["damage_state_code"] is None
    assert by_id[11]["damage_probs"] is None
    assert (by_id[11]["lon"], by_id[11]["lat"]) == (round(LON + 0.01, 5), LAT)
    intensities = [r["intensity"] for r in rows]
    assert intensities == sorted(intensities, reverse=True)
    assert infra.summarize_assets(rows) == {"health": 1, "bridge": 1, "power": 1}


def test_a_damaged_facility_is_kept_below_the_intensity_threshold(assets_path):
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    rows = infra.evaluate_assets(
        rupture, 250.0, 0.0, _tracked({"b9": (1, [0.4, 0.45, 0.1, 0.05, 0.0])})
    )
    assert rows is not None
    school = next(r for r in rows if r["asset_id"] == 12)
    assert school["intensity"] < infra.AFFECTED_INTENSITY
    assert school["damage_state_code"] == 1


def test_an_undamaged_facility_building_reports_its_distribution(assets_path):
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    probs = [0.9, 0.08, 0.02, 0.0, 0.0]
    rows = infra.evaluate_assets(rupture, 250.0, 0.0, _tracked({"b1": (0, probs)}))
    assert rows is not None
    hospital = next(r for r in rows if r["asset_id"] == 10)
    assert (hospital["damage_state_code"], hospital["damage_probs"]) == (0, probs)


def test_a_facility_whose_building_was_not_evaluated_has_no_damage(assets_path):
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    rows = infra.evaluate_assets(rupture, 250.0, 0.0, _tracked({}))
    assert rows is not None
    hospital = next(r for r in rows if r["asset_id"] == 10)
    assert hospital["damage_state_code"] is None and hospital["damage_probs"] is None


def test_facility_building_ids(assets_path):
    ids = infra.facility_building_ids()
    assert ids is not None and sorted(ids.to_pylist()) == ["b1", "b9"]


def test_no_asset_data(tmp_path, monkeypatch):
    monkeypatch.setenv("TWINER_INFRA_SITES_PATH", str(tmp_path / "missing.parquet"))
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    assert infra.evaluate_assets(rupture, 100.0, 0.0, None) is None


def test_intensity_bands_nest_around_the_epicentre(tmp_path, monkeypatch):
    monkeypatch.setenv("TWINER_VS30_SITES_PATH", str(tmp_path / "missing.parquet"))
    rupture = from_manual_input(lat=LAT, lon=LON, mag=6.5, rake=0.0)
    bands = infra.intensity_bands(rupture, 120.0, 0.0)
    levels = [f["properties"]["intensity"] for f in bands["features"]]
    assert levels == list(range(4, levels[-1] + 1))
    geoms = [shapely.geometry.shape(f["geometry"]) for f in bands["features"]]
    assert all(g.is_valid and not g.is_empty for g in geoms)
    # The epicentre falls in the top band; bands don't overlap.
    epicentre = shapely.Point(LON, LAT)
    assert geoms[-1].contains(epicentre)
    assert not any(g.contains(epicentre) for g in geoms[:-1])
    # Higher sigma (lower-probability level) shakes harder everywhere.
    stronger = infra.intensity_bands(rupture, 120.0, 1.0)
    assert stronger["features"][-1]["properties"]["intensity"] > levels[-1]
