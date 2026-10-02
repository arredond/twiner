"""NCSE-02 Annex 1 parsing and municipality matching (ncse02.py)."""

from __future__ import annotations

import pandas as pd
from exposure.ncse02 import (
    ALIASES_CSV,
    BY_MUNICIPALITY_CSV,
    by_municipality,
    load_ab_by_municipality,
    load_aliases,
    match_municipalities,
    normalise,
    parse_annex,
)

# The layout's quirks, as `pdftotext -raw` renders them.
RAW = """ANDALUCÍA
PROVINCIA DE ALMERÍA
Municipio ab/g k
EJIDO, EL 0,14 (1,0)
PROVINCIA DE CÁDIZ
CÁDIZ 0,07 (1,3)
35950 Viernes 11 octubre 2002 BARBATE 0,05 (1,2)
PROVINCIA DE CÓRDOBA
SAN SEBASTIÁN CHIPIONA 0,08 (1,2)
DE LOS BALLESTEROS 0,06 (1,0)
COMUNIDAD VALENCIANA
PROVINCIA DE ALICANTE/ALACANT
BENITACHELL/POBLE NOU
DE BENITATXELL,EL 0,05 (1,0)BOE núm. 244 Viernes 11 octubre 2002 35961
PROVINCIA DE NAVARRA
URROTZ 0,04 (1,0)
URROZ 0,04 (1,0)
ZUMARRAGA 0,04 (1,0)
CIUDAD DE CEUTA 0,05 (1,2)
CIUDAD DE MELILLA 0,08 (1,0)
"""

MUNICIPALITIES = pd.DataFrame(
    {
        "ine_code": [
            "04902",
            "11012",
            "11007",
            "11016",
            "14059",
            "03042",
            "31244",
            "31243",
            "51001",
            "52001",
        ],
        "name": [
            "El Ejido",
            "Cádiz",
            "Barbate",
            "Chipiona",
            "San Sebastián de los Ballesteros",
            "el Poble Nou de Benitatxell/Benitachell",
            "Urroz",
            "Urroz-Villa",
            "Ceuta",
            "Melilla",
        ],
    }
)


def test_normalise_moves_articles_and_strips_accents():
    assert normalise("EJIDO, EL") == normalise("El Ejido") == "EL EJIDO"
    assert normalise("HOSTALETS DE PIEROLA, ELS") == "ELS HOSTALETS DE PIEROLA"
    assert normalise("Castell d'Aro") == "CASTELL D ARO"


def test_parse_handles_wraps_headers_ceuta_and_the_merged_line():
    rows = parse_annex(RAW).set_index("ncse_name")
    assert rows.loc["EJIDO, EL", "ab_g"] == 0.14
    assert rows.loc["BARBATE", "province_code"] == "11"  # page header stripped
    assert rows.loc["CHIPIONA", "province_code"] == "11"
    assert rows.loc["SAN SEBASTIÁN DE LOS BALLESTEROS", "province_code"] == "14"
    assert rows.loc["BENITACHELL/POBLE NOU DE BENITATXELL,EL", "ab_g"] == 0.05
    assert rows.loc["CEUTA", "province_code"] == "51"
    assert rows.loc["MELILLA", "k"] == 1.0


def test_matching_uses_aliases_before_exact_names():
    matched = match_municipalities(parse_annex(RAW), MUNICIPALITIES, load_aliases())
    codes = dict(zip(matched["ncse_name"], matched["municipality_code"], strict=True))
    assert codes["EJIDO, EL"] == "04902"
    assert codes["BENITACHELL/POBLE NOU DE BENITATXELL,EL"] == "03042"
    # URROZ is today's Urroz-Villa (alias), not today's "Urroz" (URROTZ).
    assert codes["URROZ"] == "31243"
    assert codes["URROTZ"] == "31244"


def test_merged_municipalities_keep_the_highest_ab():
    matched = pd.DataFrame(
        {
            "province_code": ["08", "08"],
            "ncse_name": ["MEDIONA", "SANT JOAN DE MEDIONA"],
            "ab_g": [0.04, 0.05],
            "k": [1.0, 1.0],
            "municipality_code": ["08122", "08122"],
            "match": ["exact", "alias"],
        }
    )
    assert by_municipality(matched).iloc[0]["ab_g"] == 0.05


def test_committed_tables_are_consistent():
    aliases = pd.read_csv(ALIASES_CSV, dtype=str)
    assert aliases["ine_code"].str.fullmatch(r"\d{5}").all()
    ab = load_ab_by_municipality(BY_MUNICIPALITY_CSV)
    assert ab["ine_code"].is_unique
    assert ab["ab_g"].between(0.04, 0.25).all()
    # Lorca and Granada, as printed in Annex 1.
    by_code = ab.set_index("ine_code")["ab_g"]
    assert by_code["30024"] == 0.12 and by_code["18087"] == 0.23
