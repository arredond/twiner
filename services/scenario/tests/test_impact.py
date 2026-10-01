import numpy as np
import pyarrow as pa
import pytest
from scenario.impact import (
    DEBRIS_FRACTION,
    DEBRIS_T_PER_M2,
    REPLACEMENT_COST_EUR_PER_M2,
    TRUCK_PAYLOAD_T,
    AreaMeta,
    ImpactCounter,
)

# Two sections in one municipality, one in another.
META = AreaMeta(
    sections={
        "3002401001": {
            "code": "3002401001",
            "municipality_name": "Lorca",
            "population": 1000,
            "pop_under_15": 150,
            "pop_65_plus": 250,
            "n_buildings": 10,
            "n_dwellings": 400,
            "bbox_xmin": -1.71,
            "bbox_ymin": 37.67,
            "bbox_xmax": -1.69,
            "bbox_ymax": 37.68,
        },
        "3002401002": {
            "code": "3002401002",
            "municipality_name": "Lorca",
            "population": 500,
            "pop_under_15": 50,
            "pop_65_plus": 50,
            "n_buildings": 5,
            "n_dwellings": 0,  # no dwellings recorded: spread by building instead
        },
    },
    municipalities={
        "30024": {
            "municipality_code": "30024",
            "name": "Lorca",
            "population": 1500,
            "pop_under_15": 200,
            "pop_65_plus": 300,
            "n_buildings": 15,
            "bbox_xmin": -2.0,
            "bbox_ymin": 37.4,
            "bbox_xmax": -1.4,
            "bbox_ymax": 38.0,
        }
    },
)


def _counter() -> ImpactCounter:
    counter = ImpactCounter()
    counter.add(
        pa.array(["30024"] * 4 + ["02003"]),
        pa.array(["3002401001", "3002401001", "3002401001", "3002401002", None]),
        # Complete, Moderate, None, Extensive, Slight
        np.array([4, 2, 0, 3, 1]),
        np.array([100.0, 100.0, 50.0, 0.0, 1.0]),
        np.array([1000.0, 2000.0, 500.0, 300.0, 100.0]),
    )
    return counter


def test_section_stats_spread_population_by_dwellings():
    rows = {r["section_code"]: r for r in _counter().section_stats(META)}
    first = rows["3002401001"]
    # 200 of the section's 400 dwellings are in damaged buildings.
    assert first["affected_population"] == 500
    assert first["pct_population_affected"] == 50.0
    # Vulnerable share of the section (400/1000) applied to the affected.
    assert first["affected_vulnerable_population"] == 200
    assert first["pct_vulnerable_affected"] == 50.0
    # Only the Complete building's 100 dwellings count as displaced.
    assert first["displaced_population"] == 250
    assert first["pct_buildings_affected"] == 20.0  # 2 of 10
    assert first["name"] == "Lorca 01-001"
    assert first["bbox"] == [-1.71, 37.67, -1.69, 37.68]
    assert rows["3002401002"]["bbox"] is None  # no bbox in its census row


def test_section_without_dwellings_falls_back_to_building_share():
    rows = {r["section_code"]: r for r in _counter().section_stats(META)}
    # 1 of the section's 5 buildings damaged (Extensive -> also displaced).
    assert rows["3002401002"]["affected_population"] == 100
    assert rows["3002401002"]["displaced_population"] == 100


def test_cost_debris_and_trucks_scale_with_built_area():
    rows = {r["section_code"]: r for r in _counter().section_stats(META)}
    first = rows["3002401001"]
    # Complete 1000 m2 x 100% + Moderate 2000 m2 x 10%.
    assert first["cost_meur"] == pytest.approx(
        (1000 * 1.0 + 2000 * 0.10) * REPLACEMENT_COST_EUR_PER_M2 / 1e6
    )
    debris = DEBRIS_T_PER_M2 * (1000 * DEBRIS_FRACTION[4] + 2000 * DEBRIS_FRACTION[2])
    assert first["debris_t"] == round(debris)
    assert first["truck_rotations"] == int(np.ceil(debris / TRUCK_PAYLOAD_T))


def test_municipality_rolls_up_sections_and_keeps_unsectioned_buildings():
    rows = {r["municipality_code"]: r for r in _counter().municipality_stats(META)}
    lorca = rows["30024"]
    assert lorca["affected_population"] == 600
    assert lorca["population"] == 1500
    assert lorca["pct_population_affected"] == 40.0
    assert lorca["n_damaged"] == 3
    assert lorca["counts"] == {"None": 1, "Slight": 0, "Moderate": 1, "Extensive": 1, "Complete": 1}
    assert lorca["bbox"] == [-2.0, 37.4, -1.4, 38.0]
    # A building with no section still counts toward its municipality,
    # with no population to attribute (no census figures for it).
    other = rows["02003"]
    assert other["n_damaged"] == 1
    assert other["affected_population"] == 0
    assert other["population"] == 0


def test_undamaged_sections_are_left_out_of_section_stats():
    counter = ImpactCounter()
    counter.add(
        pa.array(["30024"]),
        pa.array(["3002401001"]),
        np.array([0]),
        np.array([5.0]),
        np.array([90.0]),
    )
    assert counter.section_stats(META) == []
    assert counter.municipality_stats(META)[0]["n_damaged"] == 0


def test_catastro_office_codes_remap_without_a_section():
    counter = ImpactCounter()
    counter.add(
        pa.array(["55101"]), pa.array([None], pa.string()), np.array([2]), np.zeros(1), np.zeros(1)
    )
    assert counter.municipality_stats(AreaMeta())[0]["municipality_code"] == "51001"


def test_undamaged_municipalities_are_slimmed_to_counts():
    counter = ImpactCounter()
    counter.add(
        pa.array(["30024"]),
        pa.array(["3002401001"]),
        np.array([0]),
        np.array([5.0]),
        np.array([90.0]),
    )
    assert counter.municipality_stats(META) == [
        {
            "municipality_code": "30024",
            "n_evaluated": 1,
            "n_damaged": 0,
            "counts": {"None": 1, "Slight": 0, "Moderate": 0, "Extensive": 0, "Complete": 0},
            "counts_reported": {
                "None": 1,
                "Slight": 0,
                "Moderate": 0,
                "Extensive": 0,
                "Complete": 0,
            },
        }
    ]


# --- expected values (ADR-0034) --------------------------------------------


def _one_building(probs: list[float], reported: int) -> ImpactCounter:
    counter = ImpactCounter()
    counter.add(
        pa.array(["30024"]),
        pa.array(["3002401001"]),
        np.array([reported]),
        np.array([40.0]),
        np.array([1000.0]),
        probs=np.array(probs)[:, None],
    )
    return counter


def test_area_figures_sum_probabilities_not_the_reported_state():
    # Reported None (its most likely state), but 30% Slight and 20% Moderate.
    row = _one_building([0.5, 0.3, 0.2, 0.0, 0.0], reported=0).section_stats(META)[0]
    assert row["counts"] == {
        "None": 0.5,
        "Slight": 0.3,
        "Moderate": 0.2,
        "Extensive": 0.0,
        "Complete": 0.0,
    }
    assert row["counts_reported"]["None"] == 1
    assert row["n_damaged"] == 0.5
    # Half its 40 dwellings are expected damaged: 20 of the section's 400.
    assert row["affected_population"] == 50
    # Cost: 1000 m2 x (30% x 2% + 20% x 10%) of replacement.
    assert row["cost_meur"] == pytest.approx(
        1000 * (0.3 * 0.02 + 0.2 * 0.10) * REPLACEMENT_COST_EUR_PER_M2 / 1e6, abs=0.01
    )


def test_areas_below_half_an_expected_damaged_building_count_as_undamaged():
    counter = _one_building([0.8, 0.15, 0.05, 0.0, 0.0], reported=0)
    assert counter.section_stats(META) == []
    assert counter.municipality_stats(META)[0]["n_damaged"] == 0
    # ... but the scenario-wide expected total still includes it.
    assert counter.n_damaged == 0.2


def test_a_reported_damaged_building_always_makes_its_area_affected():
    # Very low probability's 85th percentile can report Slight even when
    # the expected damage is small.
    row = _one_building([0.7, 0.3, 0.0, 0.0, 0.0], reported=1).section_stats(META)[0]
    assert row["counts_reported"]["Slight"] == 1
    assert row["n_damaged"] == 0.3
