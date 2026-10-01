"""Damage models and vulnerability databases a scenario can be run with.

ADR-0033. An earthquake scenario turns ground motion into damage with two
independent choices:

- a **damage model**: the calculation method (how ground motion and a
  building's vulnerability data become damage-state probabilities);
- a **vulnerability database**: where each building class's vulnerability
  data comes from.

Each declares what it needs and what it provides, so a combination is
valid only when the database provides the kind of data the model needs.
These declarations are the start of stating requirements programmatically:
a deployment for another country would enable only the models whose
inputs its data can satisfy. The public docs' "Damage models" page
tabulates the same information; keep both in sync.
"""

from __future__ import annotations

from dataclasses import dataclass

# Kinds of vulnerability data a database can provide and a model can need.
FRAGILITY_FUNCTIONS = "fragility_functions"
CAPACITY_CURVES = "capacity_curves"


@dataclass(frozen=True)
class DamageModel:
    id: str
    name: str
    needs: str  # one of the vulnerability data kinds above
    hazard_inputs: tuple[str, ...]
    exposure_inputs: tuple[str, ...]
    output: str
    reference: str


@dataclass(frozen=True)
class VulnerabilityDatabase:
    id: str
    name: str
    provides: frozenset[str]
    classes: str  # how a TWIN-ER building gets one of the database's classes
    derivation: str
    # With the capacity-spectrum model: how damage-state thresholds are set
    # on each capacity curve (capacity_spectrum.BilinearCapacity).
    damage_criteria: str
    source: str
    licence: str


_EXPOSURE = ("taxonomy_class", "height_class")
_OUTPUT = "Probability of each damage state (None, Slight, Moderate, Extensive, Complete)"

DAMAGE_MODELS: dict[str, DamageModel] = {
    m.id: m
    for m in (
        DamageModel(
            id="fragility",
            name="Fragility functions on an intensity measure",
            needs=FRAGILITY_FUNCTIONS,
            hazard_inputs=("PGA", "SA(T) at the period each curve is defined for"),
            exposure_inputs=_EXPOSURE,
            output=_OUTPUT,
            reference="Martins & Silva (2021)",
        ),
        DamageModel(
            id="capacity_spectrum",
            name="Capacity spectrum (RISK-UE Level II)",
            needs=CAPACITY_CURVES,
            hazard_inputs=("SA(Te) at each building class's elastic period", "PGA", "PGV"),
            exposure_inputs=_EXPOSURE,
            output=_OUTPUT,
            reference="Milutinovic & Trendafiloski (2003); Fajfar (2000)",
        ),
    )
}

VULNERABILITY_DATABASES: dict[str, VulnerabilityDatabase] = {
    d.id: d
    for d in (
        VulnerabilityDatabase(
            id="gem",
            name="GEM global model (Martins & Silva 2021)",
            provides=frozenset({FRAGILITY_FUNCTIONS, CAPACITY_CURVES}),
            classes="TWIN-ER's GEM taxonomy class and height (1-12 storeys) directly",
            derivation=(
                "Analytical: nonlinear dynamic analyses of equivalent single-degree-of-freedom "
                "models of each class's capacity curve, under a large set of ground-motion records"
            ),
            damage_criteria=(
                "RISK-UE WP4's (0.7Dy, Dy, Dy+0.25(Du-Dy), Du), not Martins & Silva's own, "
                "which are milder and not yet verified against the paper (ADR-0033)"
            ),
            source="https://github.com/lmartins88/global_fragility_vulnerability",
            licence="CC BY-SA 4.0",
        ),
        VulnerabilityDatabase(
            id="risk_ue",
            name="RISK-UE (Milutinovic & Trendafiloski 2003)",
            provides=frozenset({CAPACITY_CURVES}),
            classes=(
                "Mapped from TWIN-ER's class: concrete -> RC1 (low code), 1940-1969 masonry -> "
                "M3.4, pre-1940 masonry -> M1.1 (pre code); height band L 1-2, M 3-5, H 6+ storeys"
            ),
            derivation=(
                "Mechanical: pushover analyses of representative European building models by "
                "the RISK-UE partners (UNIGE masonry, AUTh concrete), idealised as bilinear curves"
            ),
            damage_criteria="RISK-UE WP4 (0.7Dy, Dy, Dy+0.25(Du-Dy), Du; WP4 Table 3.8)",
            source="RISK-UE WP4 report, Tables 3.1-1 and 3.1-2",
            licence="(c) European Commission, 2003; the nine parameter rows used are cited by table",
        ),
    )
}

DEFAULT_DAMAGE_MODEL = "fragility"
DEFAULT_VULNERABILITY_DB = "gem"


@dataclass(frozen=True)
class DamageMethod:
    model: str = DEFAULT_DAMAGE_MODEL
    database: str = DEFAULT_VULNERABILITY_DB

    @property
    def is_default(self) -> bool:
        return self == DEFAULT_METHOD

    def params(self) -> dict:
        return {"damage_model": self.model, "vulnerability_db": self.database}


DEFAULT_METHOD = DamageMethod()


def resolve_damage_method(model: str | None = None, database: str | None = None) -> DamageMethod:
    """Raises ValueError for an unknown model or database, or a database
    that doesn't provide the data the model needs."""
    method = DamageMethod(model or DEFAULT_DAMAGE_MODEL, database or DEFAULT_VULNERABILITY_DB)
    if method.model not in DAMAGE_MODELS:
        raise ValueError(
            f"unknown damage_model {method.model!r}, expected one of {sorted(DAMAGE_MODELS)}"
        )
    if method.database not in VULNERABILITY_DATABASES:
        raise ValueError(
            f"unknown vulnerability_db {method.database!r}, "
            f"expected one of {sorted(VULNERABILITY_DATABASES)}"
        )
    needs = DAMAGE_MODELS[method.model].needs
    if needs not in VULNERABILITY_DATABASES[method.database].provides:
        raise ValueError(
            f"vulnerability_db {method.database!r} has no {needs.replace('_', ' ')}, "
            f"which damage_model {method.model!r} needs"
        )
    return method


def compatible_methods() -> list[DamageMethod]:
    return [
        DamageMethod(m, d)
        for m, model in DAMAGE_MODELS.items()
        for d, db in VULNERABILITY_DATABASES.items()
        if model.needs in db.provides
    ]


def methods_payload() -> dict:
    """GET /methods: every damage model and vulnerability database, what
    each needs and provides, and the valid combinations."""
    return {
        "default": DEFAULT_METHOD.params(),
        "damage_models": [
            {
                "id": m.id,
                "name": m.name,
                "needs": m.needs,
                "hazard_inputs": list(m.hazard_inputs),
                "exposure_inputs": list(m.exposure_inputs),
                "output": m.output,
                "reference": m.reference,
            }
            for m in DAMAGE_MODELS.values()
        ],
        "vulnerability_databases": [
            {
                "id": d.id,
                "name": d.name,
                "provides": sorted(d.provides),
                "classes": d.classes,
                "derivation": d.derivation,
                "damage_criteria": d.damage_criteria,
                "source": d.source,
                "licence": d.licence,
            }
            for d in VULNERABILITY_DATABASES.values()
        ],
        "compatible": [m.params() for m in compatible_methods()],
    }
