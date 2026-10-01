"""Capacity-spectrum damage model (RISK-UE Level II, ADR-0033)."""

from __future__ import annotations

import math

import numpy as np
import pytest
from scenario.capacity_spectrum import (
    BilinearCapacity,
    G,
    corner_period_s,
    damage_probabilities,
    evaluate_capacity_spectrum,
    load_capacity_table,
    performance_point_m,
    risk_ue_height_band,
    sa_key,
)
from scenario.damage import DAMAGE_STATES

# RISK-UE WP4 Table 3.1-2, RC1L low code (AUTh): Dy 2.32 cm, Ay 0.192 g, Du 9.58 cm.
RC1L = BilinearCapacity(0.0232, 0.192, 0.0958)


def test_thresholds_and_dispersions_follow_risk_ue_wp4():
    dy, du = 0.0232, 0.0958
    assert RC1L.thresholds_m == pytest.approx([0.7 * dy, dy, dy + 0.25 * (du - dy), du])
    ln_mu = math.log(du / dy)
    assert RC1L.betas == pytest.approx(
        [0.25 + 0.07 * ln_mu, 0.2 + 0.18 * ln_mu, 0.1 + 0.4 * ln_mu, 0.15 + 0.5 * ln_mu]
    )


def test_elastic_period_from_the_yield_point():
    assert RC1L.period_s == pytest.approx(2 * math.pi * math.sqrt(0.0232 / (0.192 * G)), abs=1e-3)


def test_performance_point_closed_form():
    te = RC1L.period_s
    sde = lambda sae: sae * G * (te / (2 * math.pi)) ** 2
    # Elastic (Sae below the yield acceleration): the elastic displacement.
    assert performance_point_m(RC1L, np.array([0.1]), np.array([0.5]))[0] == pytest.approx(sde(0.1))
    # Inelastic, Te >= Tc: equal displacement.
    assert performance_point_m(RC1L, np.array([0.4]), np.array([0.3]))[0] == pytest.approx(sde(0.4))
    # Inelastic, Te < Tc: Dy * ((R - 1) Tc/Te + 1), larger than the elastic displacement.
    tc = 1.0
    r = 0.4 / 0.192
    sd = performance_point_m(RC1L, np.array([0.4]), np.array([tc]))[0]
    assert sd == pytest.approx(0.0232 * ((r - 1) * tc / te + 1), rel=1e-3)
    assert sd > sde(0.4)


def test_corner_period_from_pga_and_pgv():
    # 0.3 g and 30 cm/s: 2*pi * 1.65*0.30 / (2.12*0.3*9.80665)
    assert corner_period_s(np.array([0.3]), np.array([30.0]))[0] == pytest.approx(
        2 * math.pi * 1.65 * 0.30 / (2.12 * 0.3 * G)
    )


def test_damage_probabilities_are_a_distribution_and_hit_the_medians():
    sd = np.geomspace(1e-4, 0.5, 50)
    probs = damage_probabilities(RC1L, sd)
    assert probs.shape == (len(DAMAGE_STATES), len(sd))
    assert np.all(probs >= -1e-12)
    assert probs.sum(axis=0) == pytest.approx(np.ones(len(sd)))
    # At the Moderate threshold, P(>= Moderate) = 0.5.
    at = damage_probabilities(RC1L, RC1L.thresholds_m[1:2])
    assert at[2:].sum() == pytest.approx(0.5, abs=1e-6)
    # More displacement never means less damage.
    expected_state = (probs * np.arange(len(DAMAGE_STATES))[:, None]).sum(axis=0)
    assert np.all(np.diff(expected_state) >= -1e-9)


def _fields(c: BilinearCapacity) -> list[float]:
    return [c.dy_m, c.ay_g, c.du_m]


def test_risk_ue_mapping_and_height_bands():
    table = load_capacity_table("risk_ue")
    assert [risk_ue_height_band(n) for n in (1, 2, 3, 5, 6, 12)] == list("LLMMHH")
    assert _fields(table.get("CR_LDUAL-DUL", 1)) == pytest.approx(_fields(RC1L))
    # Pre-1940 rubble stone -> M1.1 pre code, mid-rise.
    assert _fields(table.get("MUR-STRUB_LWAL-DNO", 4)) == pytest.approx([0.0047, 0.115, 0.0203])


def test_gem_curves_use_the_yield_and_ultimate_points_and_nearest_height():
    table = load_capacity_table("gem")
    # Martins & Silva MUR_LWAL-DNO_H2: yield (0.006 m, 0.285 g), ultimate 0.034 m.
    assert table.get("MUR_LWAL-DNO", 2) == BilinearCapacity(0.006, 0.285, 0.034)
    # Masonry stops at 5 storeys upstream: taller buildings use H5.
    assert table.get("MUR_LWAL-DNO", 9) == table.get("MUR_LWAL-DNO", 5)


def test_evaluate_dispatches_each_class_to_its_own_period():
    table = load_capacity_table("risk_ue")
    classes = np.array(["CR_LDUAL-DUL", "MUR-STRUB_LWAL-DNO", "CR_LDUAL-DUL"])
    heights = np.array([1, 2, 1])
    ims = {"PGA [g]": np.full(3, 0.3), "PGV [cm/s]": np.full(3, 25.0)}
    for period in table.periods():
        ims[sa_key(period)] = np.full(3, 0.5)
    result = evaluate_capacity_spectrum(table, classes, heights, ims)
    assert result.im_value[0] == pytest.approx(result.im_value[2])
    assert result.im_value[0] != pytest.approx(result.im_value[1])
    assert result.probs.sum(axis=0) == pytest.approx(np.ones(3))
    # Very low probability (85th percentile) is never milder than modal.
    pessimistic = evaluate_capacity_spectrum(table, classes, heights, ims, damage_percentile=0.85)
    assert np.all(pessimistic.damage_state_code >= result.damage_state_code)
