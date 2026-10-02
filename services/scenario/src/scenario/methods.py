"""Damage models and vulnerability databases a scenario can be run with.

ADR-0033. An earthquake scenario turns ground motion into damage with three
choices:

- a **damage model**: the calculation method (how ground motion and a
  building's vulnerability data become damage-state probabilities);
- a **vulnerability database**: where each building class's vulnerability
  data comes from;
- a **classification scheme** (ADR-0035): how each building got a class in
  the database's taxonomy. Every scheme is precomputed per building by the
  exposure pipeline (pipelines/exposure classification.py, which declares
  the same schemes) and stored as columns of exposure.parquet, so a
  scenario only reads the chosen scheme's column -- no taxonomy is ever
  translated into another at run time.

Each declares what it needs and what it provides, so a combination is
valid only when the database provides the kind of data the model needs
and the scheme classifies buildings in the database's taxonomy.
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
class ClassificationScheme:
    id: str
    name: str
    taxonomy: str  # the vulnerability databases' `taxonomy` it classifies into
    # The exposure columns giving a building's class in that taxonomy, as a
    # DuckDB expression over the exposure table `e`.
    class_sql: str
    requires: tuple[str, ...]  # building/site attributes the scheme uses
    method: str
    reference: str


@dataclass(frozen=True)
class VulnerabilityDatabase:
    id: str
    name: str
    taxonomy: str  # the class system its data is keyed by
    provides: frozenset[str]
    classes: str  # the classes it has data for
    derivation: str
    # With the capacity-spectrum model: how damage-state thresholds are set
    # on each capacity curve (capacity_spectrum.BilinearCapacity).
    damage_criteria: str
    source: str
    licence: str


_EXPOSURE = ("vulnerability class (from the chosen classification scheme)", "storeys")
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
            taxonomy="gem",
            provides=frozenset({FRAGILITY_FUNCTIONS, CAPACITY_CURVES}),
            classes="GEM taxonomy strings by height (1-12 storeys; nearest height vendored)",
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
            taxonomy="risk_ue",
            provides=frozenset({CAPACITY_CURVES}),
            classes=(
                "RISK-UE type, code level and height band (L 1-2, M 3-5, H 6+ storeys). WP4 "
                "tabulates curves for M1.2, M3.4 and RC1 (pre code), RC1, RC3.1 and RC3.2 (low "
                "code); M3.1 uses M1.2 and RC3.x at other code levels use low code "
                "(risk_ue_2003_substitutions.csv)"
            ),
            derivation=(
                "Mechanical: pushover analyses of representative European building models by "
                "the RISK-UE partners (UNIGE masonry, AUTh concrete), idealised as bilinear curves"
            ),
            damage_criteria="RISK-UE WP4 (0.7Dy, Dy, Dy+0.25(Du-Dy), Du; WP4 Table 3.8)",
            source="RISK-UE WP4 report, Tables 3.1-1 and 3.1-2",
            licence="(c) European Commission, 2003; the parameter rows used are cited by table",
        ),
    )
}

CLASSIFICATION_SCHEMES: dict[str, ClassificationScheme] = {
    c.id: c
    for c in (
        ClassificationScheme(
            id="gem_heuristic",
            name="GEM classes from construction year and storeys (TWIN-ER heuristic)",
            taxonomy="gem",
            class_sql="e.taxonomy_class",
            requires=("construction_year", "floors"),
            method=(
                "Material and lateral system by construction era (pre-1940 and 1940-1959 "
                "masonry, 1960-1979 concrete, then ductile concrete), height from storeys"
            ),
            reference="TWIN-ER (docs/TAXONOMY.md; ADR-0012, ADR-0032)",
        ),
        ClassificationScheme(
            id="risk_ue_feriche2012",
            name="RISK-UE types from construction year, storeys and NCSE-02 (Feriche et al. 2012)",
            taxonomy="risk_ue",
            class_sql=("e.risk_ue_class || ':' || e.risk_ue_code_level || ':' || e.risk_ue_height"),
            requires=("construction_year", "floors", "NCSE-02 basic acceleration ab"),
            method=(
                "Type by construction year (<=1945 M3.1, 1946-59 M3.4, 1960-96 RC1, 1997-2004 "
                "RC3.2, 2005+ RC3.1); concrete code level pre <1970, low 1970-96, moderate "
                "1997+, and pre code wherever NCSE-02's ab < 0.04 g. Calibrated on Lorca, "
                "applied to all of Spain"
            ),
            reference=(
                "Feriche et al. (2012), Fisica de la Tierra 24, Tables 2 and 5; "
                "NCSE-02 (RD 997/2002) Annex 1"
            ),
        ),
    )
}

DEFAULT_DAMAGE_MODEL = "fragility"
DEFAULT_VULNERABILITY_DB = "gem"
# Each taxonomy's default scheme: the only one, for now.
DEFAULT_CLASSIFICATION = {"gem": "gem_heuristic", "risk_ue": "risk_ue_feriche2012"}


@dataclass(frozen=True)
class DamageMethod:
    model: str = DEFAULT_DAMAGE_MODEL
    database: str = DEFAULT_VULNERABILITY_DB
    # "" -> the database's taxonomy's default scheme.
    classification: str = ""

    def __post_init__(self) -> None:
        if not self.classification and self.database in VULNERABILITY_DATABASES:
            taxonomy = VULNERABILITY_DATABASES[self.database].taxonomy
            object.__setattr__(self, "classification", DEFAULT_CLASSIFICATION[taxonomy])

    @property
    def is_default(self) -> bool:
        return self == DEFAULT_METHOD

    @property
    def scheme(self) -> ClassificationScheme:
        return CLASSIFICATION_SCHEMES[self.classification]

    def params(self) -> dict:
        return {
            "damage_model": self.model,
            "vulnerability_db": self.database,
            "classification": self.classification,
        }


DEFAULT_METHOD = DamageMethod()


def resolve_damage_method(
    model: str | None = None, database: str | None = None, classification: str | None = None
) -> DamageMethod:
    """Raises ValueError for an unknown model, database or scheme, a
    database that doesn't provide the data the model needs, or a scheme
    that doesn't classify into the database's taxonomy. The scheme defaults
    to the database's taxonomy's default."""
    database = database or DEFAULT_VULNERABILITY_DB
    if database not in VULNERABILITY_DATABASES:
        raise ValueError(
            f"unknown vulnerability_db {database!r}, "
            f"expected one of {sorted(VULNERABILITY_DATABASES)}"
        )
    taxonomy = VULNERABILITY_DATABASES[database].taxonomy
    method = DamageMethod(model or DEFAULT_DAMAGE_MODEL, database, classification or "")
    if method.model not in DAMAGE_MODELS:
        raise ValueError(
            f"unknown damage_model {method.model!r}, expected one of {sorted(DAMAGE_MODELS)}"
        )
    if method.classification not in CLASSIFICATION_SCHEMES:
        raise ValueError(
            f"unknown classification {method.classification!r}, "
            f"expected one of {sorted(CLASSIFICATION_SCHEMES)}"
        )
    if method.scheme.taxonomy != taxonomy:
        raise ValueError(
            f"classification {method.classification!r} gives {method.scheme.taxonomy} classes, "
            f"but vulnerability_db {database!r} is keyed by {taxonomy} classes"
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
        DamageMethod(m, d, c)
        for m, model in DAMAGE_MODELS.items()
        for d, db in VULNERABILITY_DATABASES.items()
        for c, scheme in CLASSIFICATION_SCHEMES.items()
        if model.needs in db.provides and scheme.taxonomy == db.taxonomy
    ]


def methods_payload() -> dict:
    """GET /methods: every damage model, vulnerability database and
    classification scheme, what each needs and provides, and the valid
    combinations."""
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
                "taxonomy": d.taxonomy,
                "provides": sorted(d.provides),
                "classes": d.classes,
                "derivation": d.derivation,
                "damage_criteria": d.damage_criteria,
                "source": d.source,
                "licence": d.licence,
            }
            for d in VULNERABILITY_DATABASES.values()
        ],
        "classifications": [
            {
                "id": c.id,
                "name": c.name,
                "taxonomy": c.taxonomy,
                "requires": list(c.requires),
                "method": c.method,
                "reference": c.reference,
                "default_for_taxonomy": DEFAULT_CLASSIFICATION[c.taxonomy] == c.id,
            }
            for c in CLASSIFICATION_SCHEMES.values()
        ],
        "compatible": [m.params() for m in compatible_methods()],
    }
