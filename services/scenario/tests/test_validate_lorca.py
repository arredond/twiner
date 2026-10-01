"""The Lorca 2011 comparison report's formatting (validate_lorca.py); the
numbers themselves need the national data and are run by hand."""

from __future__ import annotations

from scenario.validate_lorca import OBSERVED_ANY, OBSERVED_MODERATE_PLUS, to_markdown


def test_report_has_observed_row_and_one_row_per_run():
    counts = {
        "None": 6_000.0,
        "Slight": 600.0,
        "Moderate": 300.0,
        "Extensive": 80.0,
        "Complete": 21.0,
    }
    result = {
        "level": "low",
        "method": "fragility + gem",
        "town_buildings": 7_001,
        "town_expected": counts,
        "town_reported": counts,
        "municipality_expected": counts,
    }
    report = to_markdown([result, {**result, "level": "high"}])
    assert f"{OBSERVED_ANY:,}" in report and f"{OBSERVED_MODERATE_PLUS:,}" in report
    # Any damage = 600 + 300 + 80 + 21 = 1,001 of 7,001; moderate+ = 401.
    assert "| low | fragility + gem | 600 | 300 | 80 | 21 | 1,001 (14%) | 401 (6%) |" in report
    assert report.count("| high | fragility + gem |") == 3  # town, reported, municipality
