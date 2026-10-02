"""Damage-model / vulnerability-database / classification registry
(methods.py, ADR-0033, ADR-0035)."""

from __future__ import annotations

import pytest
from scenario.methods import (
    DEFAULT_METHOD,
    DamageMethod,
    compatible_methods,
    methods_payload,
    resolve_damage_method,
)
from scenario.scenario_id import fault_scenario_id, manual_scenario_id


def test_defaults_are_todays_method():
    assert resolve_damage_method() == DEFAULT_METHOD == DamageMethod("fragility", "gem")
    assert DEFAULT_METHOD.classification == "gem_heuristic"


def test_classification_defaults_to_the_database_taxonomy():
    assert resolve_damage_method("capacity_spectrum", "risk_ue").classification == (
        "risk_ue_feriche2012"
    )
    assert DamageMethod("capacity_spectrum", "risk_ue").scheme.taxonomy == "risk_ue"


def test_a_classification_in_another_taxonomy_is_rejected():
    with pytest.raises(ValueError, match="keyed by gem classes"):
        resolve_damage_method("capacity_spectrum", "gem", "risk_ue_feriche2012")
    with pytest.raises(ValueError, match="unknown classification"):
        resolve_damage_method("capacity_spectrum", "gem", "nope")


def test_capacity_spectrum_runs_on_either_database():
    for db in ("gem", "risk_ue"):
        assert resolve_damage_method("capacity_spectrum", db).database == db


def test_a_database_without_the_data_a_model_needs_is_rejected():
    with pytest.raises(ValueError, match="no fragility functions"):
        resolve_damage_method("fragility", "risk_ue")


@pytest.mark.parametrize("model,db", [("nope", "gem"), ("fragility", "nope")])
def test_unknown_names_are_rejected(model, db):
    with pytest.raises(ValueError, match="unknown"):
        resolve_damage_method(model, db)


def test_compatible_combinations():
    assert {(m.model, m.database, m.classification) for m in compatible_methods()} == {
        ("fragility", "gem", "gem_heuristic"),
        ("capacity_spectrum", "gem", "gem_heuristic"),
        ("capacity_spectrum", "risk_ue", "risk_ue_feriche2012"),
    }
    assert len(methods_payload()["compatible"]) == 3


def test_default_method_leaves_scenario_ids_unchanged():
    # Ids for the default method must not change (cached results stay valid).
    assert manual_scenario_id(37.7, -1.7, 5.2, 0, None, None, None, "high") == manual_scenario_id(
        37.7, -1.7, 5.2, 0, None, None, None, "high", method=None
    )
    other = DamageMethod("capacity_spectrum", "risk_ue").params()
    assert fault_scenario_id("ES626", "high") != fault_scenario_id("ES626", "high", method=other)
