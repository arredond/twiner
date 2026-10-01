"""Capacity-spectrum damage model: RISK-UE Level II (LM2), ADR-0033.

For each building class, a bilinear capacity curve (yield point Dy, Ay;
ultimate point Du) from a vulnerability database (methods.py):

1. Elastic period of the equivalent single-degree-of-freedom system:
   Te = 2*pi*sqrt(Dy / (Ay*g)).
2. Demand: the site's 5%-damped elastic spectral acceleration at Te,
   Sae = SA(Te), from the same GMPE as every other path
   (ground_motion.py), and its corner period Tc (below).
3. Performance point, closed form for an elastic-perfectly-plastic curve
   (N2 method, Fajfar 2000; RISK-UE WP4 Eqs. 3-16 to 3-18):
   Sde = Sae*g*(Te/2pi)^2, R = Sae/Ay, and the inelastic displacement
   Sd = Sde                        if R <= 1 or Te >= Tc (equal displacement)
   Sd = Dy * ((R - 1)*Tc/Te + 1)   otherwise.
4. Damage: lognormal fragility on spectral displacement,
   P(DS >= ds_k) = Phi(ln(Sd / Sd_k) / beta_k), with the RISK-UE WP4
   thresholds Sd_1..4 = 0.7Dy, Dy, Dy + 0.25(Du - Dy), Du and dispersions
   from the ultimate ductility mu_u = Du/Dy (WP4 Table 3.8, step 4A):
   beta_1..4 = 0.25 + 0.07 ln mu_u, 0.2 + 0.18 ln mu_u, 0.1 + 0.4 ln mu_u,
   0.15 + 0.5 ln mu_u.

Corner period: Tc = 2*pi * (c_v * PGV) / (c_a * PGA), with Newmark &
Hall's (1982) median 5%-damping spectral amplification factors c_a = 2.12
and c_v = 1.65 -- the spectrum's switch from constant acceleration to
constant velocity, from the GMPE's own PGA and PGV at the site.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

import numpy as np
import pandas as pd
import pyarrow as pa
from openquake.hazardlib.imt import IMT, PGA, PGV, SA
from scipy.stats import norm

from .damage import DAMAGE_STATES, DamageArrays, select_damage_states

G = 9.80665  # m/s^2
NEWMARK_HALL_CA = 2.12
NEWMARK_HALL_CV = 1.65
# The GMPE's SA period range (Akkar et al. 2014: 0.01-4 s).
_MIN_PERIOD_S, _MAX_PERIOD_S = 0.01, 4.0

PGA_KEY = "PGA [g]"
PGV_KEY = "PGV [cm/s]"
SD_IM_TYPE = "Sd [m]"


@dataclass(frozen=True)
class BilinearCapacity:
    dy_m: float
    ay_g: float
    du_m: float

    @property
    def period_s(self) -> float:
        te = 2 * math.pi * math.sqrt(self.dy_m / (self.ay_g * G))
        return round(min(max(te, _MIN_PERIOD_S), _MAX_PERIOD_S), 3)

    @property
    def thresholds_m(self) -> np.ndarray:
        dy, du = self.dy_m, self.du_m
        return np.array([0.7 * dy, dy, dy + 0.25 * (du - dy), du])

    @property
    def betas(self) -> np.ndarray:
        ln_mu = math.log(max(self.du_m / self.dy_m, 1.0))
        return np.array(
            [0.25 + 0.07 * ln_mu, 0.2 + 0.18 * ln_mu, 0.1 + 0.4 * ln_mu, 0.15 + 0.5 * ln_mu]
        )


def _data(name: str) -> pd.DataFrame:
    with resources.files(__package__).joinpath("vulnerability_data", name).open() as f:
        return pd.read_csv(f)


# RISK-UE database (methods.py): TWIN-ER's GEM class -> RISK-UE building
# type and code level; height band by storeys, per RISK-UE's typology
# matrix (WP4 Table 1.1): L 1-2, M 3-5, H 6+.
GEM_TO_RISK_UE = {
    "CR_LDUAL-DUL": ("RC1", "low"),
    "MUR_LWAL-DNO": ("M3.4", "pre"),
    "MUR-STRUB_LWAL-DNO": ("M1.1", "pre"),
}


def risk_ue_height_band(storeys: int) -> str:
    return "L" if storeys <= 2 else "M" if storeys <= 5 else "H"


class CapacityTable:
    """One vulnerability database's capacity curves, looked up by TWIN-ER's
    (taxonomy_class, height_class)."""

    def __init__(self, database: str):
        self.database = database
        if database == "gem":
            self._curves = _gem_curves()
        elif database == "risk_ue":
            self._curves = _risk_ue_curves()
        else:
            raise ValueError(f"no capacity curves for vulnerability_db {database!r}")

    def get(self, taxonomy_class: str, height_class: int) -> BilinearCapacity:
        if self.database == "risk_ue":
            if taxonomy_class not in GEM_TO_RISK_UE:
                raise KeyError(f"no RISK-UE mapping for taxonomy {taxonomy_class!r}")
            risk_ue_class, code = GEM_TO_RISK_UE[taxonomy_class]
            return self._curves[(risk_ue_class, code, risk_ue_height_band(height_class))]
        # GEM: nearest vendored height, as fragility_lookup.FragilityTable does.
        heights = sorted(h for t, h in self._curves if t == taxonomy_class)
        if not heights:
            raise KeyError(f"no capacity curve vendored for taxonomy {taxonomy_class!r}")
        nearest = min(heights, key=lambda h: abs(h - height_class))
        return self._curves[(taxonomy_class, nearest)]

    def periods(self) -> list[float]:
        return sorted({c.period_s for c in self._curves.values()})


def _gem_curves() -> dict:
    """Martins & Silva's curves are origin, cracking, yield, ultimate: the
    bilinear idealisation takes the yield point (the third row) and the
    ultimate displacement (the last)."""
    curves = {}
    for (taxonomy, height), curve in _data("martins_silva_2021_capacity.csv").groupby(
        ["taxonomy", "height_class"]
    ):
        curve = curve.sort_values("point")
        yield_point, ultimate = curve.iloc[2], curve.iloc[-1]
        curves[(taxonomy, int(height))] = BilinearCapacity(
            float(yield_point.sd_m), float(yield_point.sa_g), float(ultimate.sd_m)
        )
    return curves


def _risk_ue_curves() -> dict:
    """Dy, Du are tabulated in cm."""
    table = _data("risk_ue_2003_capacity.csv")
    return {
        (cls, code, height): BilinearCapacity(dy / 100, ay, du / 100)
        for cls, code, height, dy, ay, du in zip(
            table["risk_ue_class"].astype(str),
            table["code_level"].astype(str),
            table["height"].astype(str),
            table["dy_cm"].astype(float),
            table["ay_g"].astype(float),
            table["du_cm"].astype(float),
            strict=True,
        )
    }


@lru_cache(maxsize=4)
def load_capacity_table(database: str) -> CapacityTable:
    return CapacityTable(database)


def sa_key(period_s: float) -> str:
    return f"SA({period_s:.3f}s) [g]"


def required_imts(table: CapacityTable) -> dict[str, IMT]:
    """The ground motion this table's classes need: SA at each distinct
    elastic period, plus PGA and PGV for the corner period."""
    imts: dict[str, IMT] = {PGA_KEY: PGA(), PGV_KEY: PGV()}
    for period in table.periods():
        imts[sa_key(period)] = SA(period)
    return imts


def performance_point_m(
    curve: BilinearCapacity, sae_g: np.ndarray, corner_period_s: np.ndarray
) -> np.ndarray:
    """Inelastic spectral displacement demand (m), N2 closed form."""
    te = curve.period_s
    sde = sae_g * G * (te / (2 * math.pi)) ** 2
    r = sae_g / curve.ay_g
    short_period = (r > 1) & (te < corner_period_s)
    mu = (r - 1) * corner_period_s / te + 1
    return np.where(short_period, curve.dy_m * mu, sde)


def corner_period_s(pga_g: np.ndarray, pgv_cm_s: np.ndarray) -> np.ndarray:
    pga = np.maximum(pga_g, 1e-6) * G
    return 2 * math.pi * (NEWMARK_HALL_CV * pgv_cm_s / 100) / (NEWMARK_HALL_CA * pga)


def damage_probabilities(curve: BilinearCapacity, sd_m: np.ndarray) -> np.ndarray:
    """(len(DAMAGE_STATES), n): discrete state probabilities, None first."""
    sd = np.maximum(sd_m, 1e-9)
    exceed = norm.cdf(np.log(sd[None, :] / curve.thresholds_m[:, None]) / curve.betas[:, None])
    # Different dispersions can make the curves cross far in the tails;
    # a more severe state can't be likelier to be reached than a milder one.
    exceed = np.minimum.accumulate(exceed, axis=0)
    cumulative = np.vstack([np.ones_like(sd), exceed, np.zeros_like(sd)])
    return cumulative[:-1] - cumulative[1:]


def evaluate_capacity_spectrum(
    table: CapacityTable,
    taxonomy_classes: np.ndarray | pa.Array,
    height_classes: np.ndarray,
    im_values_by_type: dict[str, np.ndarray],
    damage_percentile: float | None = None,
) -> DamageArrays:
    """The capacity-spectrum counterpart of damage.evaluate_damage_arrays,
    with the same output. `im_value` records each building's performance
    point displacement (m)."""
    n = len(height_classes)
    damage_codes = np.zeros(n, dtype=np.int8)
    sd_values = np.zeros(n)
    probs = np.zeros((len(DAMAGE_STATES), n))
    im_type_codes = np.zeros(n, dtype=np.int8)
    if n == 0:
        return DamageArrays(damage_codes, probs, sd_values, im_type_codes, [SD_IM_TYPE])

    tc = corner_period_s(
        np.asarray(im_values_by_type[PGA_KEY]), np.asarray(im_values_by_type[PGV_KEY])
    )
    taxonomy = pa.array(taxonomy_classes, type=pa.string()).dictionary_encode()
    names = taxonomy.dictionary.to_pylist()
    codes = taxonomy.indices.to_numpy(zero_copy_only=False).astype(np.int64)
    heights = np.asarray(height_classes, dtype=np.int64)
    keys, group_of = np.unique(codes * 1_000_000 + heights, return_inverse=True)
    for k, key in enumerate(keys.tolist()):
        idx = np.flatnonzero(group_of == k)
        curve = table.get(names[key // 1_000_000], key % 1_000_000)
        sae = np.asarray(im_values_by_type[sa_key(curve.period_s)])[idx]
        sd = performance_point_m(curve, sae, tc[idx])
        group_probs = damage_probabilities(curve, sd)
        sd_values[idx] = sd
        probs[:, idx] = group_probs
        damage_codes[idx] = select_damage_states(group_probs, damage_percentile)
    return DamageArrays(damage_codes, probs, sd_values, im_type_codes, [SD_IM_TYPE])
