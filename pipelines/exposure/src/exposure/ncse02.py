"""NCSE-02 basic seismic acceleration (ab) and contribution coefficient (K)
per municipality, from the Spanish seismic building code.

Source: Real Decreto 997/2002, *Norma de Construcción Sismorresistente:
parte general y edificación (NCSE-02)*, BOE núm. 244, 11 October 2002,
Annex 1 ("valores de la aceleración sísmica básica, ab, y del coeficiente
de contribución, K, de los términos municipales con ab ≥ 0,04 g"). The BOE
publishes the annex only inside the PDF, so it's parsed from
`pdftotext -raw` output (poppler: `brew install poppler`). Municipalities
not listed have ab < 0.04 g, where NCSE-02 doesn't require seismic design.

Annex 1 names municipalities as of 2002, by province. They're matched to
today's INE codes (municipalities.parquet, IGN names) by normalised name
within the province: accents stripped, articles moved to the front ("EJIDO,
EL" -> "EL EJIDO"), either side of bilingual names ("ALICANTE/ALACANT").
What's left falls back to a close fuzzy match, and anything still unmatched
is reported, not guessed.

Used by the vulnerability classification schemes (ADR-0035) to decide
whether a building's construction era could have had seismic design at all.

CLI: uv run python -m exposure.ncse02 <municipalities.parquet>
(rewrites ncse02_data/annex1.csv and ab_by_municipality.csv)
"""

from __future__ import annotations

import difflib
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

import pandas as pd
import requests

BOE_PDF_URL = "https://www.boe.es/boe/dias/2002/10/11/pdfs/A35898-35967.pdf"
# Annex 1 sits on these pages of that PDF.
ANNEX_FIRST_PAGE, ANNEX_LAST_PAGE = 52, 70

# NCSE-02's province headings (normalised) -> INE province code.
PROVINCES = {
    "ALAVA": "01", "ALBACETE": "02", "ALICANTE ALACANT": "03", "ALMERIA": "04",
    "AVILA": "05", "BADAJOZ": "06", "ILLES BALEARS": "07", "BARCELONA": "08",
    "BURGOS": "09", "CACERES": "10", "CADIZ": "11", "CASTELLON CASTELLO": "12",
    "CIUDAD REAL": "13", "CORDOBA": "14", "A CORUNA": "15", "CUENCA": "16",
    "GIRONA": "17", "GRANADA": "18", "GUADALAJARA": "19", "GUIPUZCOA": "20",
    "HUELVA": "21", "HUESCA": "22", "JAEN": "23", "LEON": "24", "LLEIDA": "25",
    "LA RIOJA": "26", "LUGO": "27", "MADRID": "28", "MALAGA": "29", "MURCIA": "30",
    "NAVARRA": "31", "OURENSE": "32", "ASTURIAS": "33", "PALENCIA": "34",
    "LAS PALMAS": "35", "PONTEVEDRA": "36", "SALAMANCA": "37",
    "SANTA CRUZ DE TENERIFE": "38", "CANTABRIA": "39", "SEGOVIA": "40",
    "SEVILLA": "41", "SORIA": "42", "TARRAGONA": "43", "TERUEL": "44",
    "TOLEDO": "45", "VALENCIA VALENCIA": "46", "VALLADOLID": "47", "VIZCAYA": "48",
    "ZAMORA": "49", "ZARAGOZA": "50", "CEUTA": "51", "MELILLA": "52",
}  # fmt: skip

_ENTRY = re.compile(r"^(?P<name>[^\d]+?)\s+(?P<ab>0,\d+)\s+\((?P<k>\d,\d+)\)\s*$")
_PROVINCE = re.compile(r"^PROVINCIA DE (?P<name>.+?)\s*$")
_ARTICLES = (
    "EL", "LA", "LOS", "LAS", "L", "LES", "ELS", "LO", "ES", "SES", "SA", "O", "A", "OS", "AS",
)  # fmt: skip
_PAGE_FOOTER = re.compile(r"BOE n.m\. \d+.*$")  # odd pages: "BOE núm. 244 Viernes ..."
_PAGE_HEADER = re.compile(r"^\d{5} Viernes 11 octubre 2002\s*")  # even pages
FUZZY_CUTOFF = 0.88

DATA_DIR = Path(__file__).parent / "ncse02_data"
# Hand-checked mapping for Annex 1 names that don't match today's
# municipality by name: renamed, merged, a locality inside a municipality,
# or a 2002 name that now belongs to a different municipality. One row per
# entry, with today's name, the relation and a note (ADR-0035).
ALIASES_CSV = DATA_DIR / "aliases.csv"
# Outputs, committed so they can be reused without re-parsing the BOE PDF.
ANNEX_CSV = DATA_DIR / "annex1.csv"
BY_MUNICIPALITY_CSV = DATA_DIR / "ab_by_municipality.csv"


def load_aliases(path: Path = ALIASES_CSV) -> dict[tuple[str, str], str]:
    """(province code, normalised NCSE-02 name) -> INE municipality code."""
    table = pd.read_csv(path, dtype=str)
    return {
        (p, normalise(n)): c
        for p, n, c in zip(
            table["province_code"], table["ncse02_name"], table["ine_code"], strict=True
        )
    }


def normalise(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    text = re.sub(r"[^A-Z0-9,]+", " ", text).strip()
    # "EJIDO, EL" -> "EL EJIDO"
    if "," in text:
        head, _, tail = text.rpartition(",")
        if tail.strip() in _ARTICLES:
            text = f"{tail.strip()} {head.strip()}"
    return re.sub(r"\s+", " ", text.replace(",", " ")).strip()


def variants(name: str) -> set[str]:
    """Normalised forms of a (possibly bilingual "A/B") name."""
    return {normalise(part) for part in [name, *name.split("/")] if part.strip()}


def parse_annex(text: str) -> pd.DataFrame:
    """Rows of (province_code, ncse_name, ab_g, k) from `pdftotext -raw`.

    Handles the layout's quirks: names wrapped over two lines ("VILLANUEVA
    DE" / "LOS CASTILLEJOS 0,11 (1,3)"), page footers glued onto an entry,
    Ceuta and Melilla (listed after the last province, under no province
    heading), and one line where two columns ran together (below)."""
    rows, province, pending = [], None, ""

    def add(prov: str, name: str, ab: str, k: str) -> None:
        rows.append(
            {
                "province_code": prov,
                "ncse_name": name.strip(),
                "ab_g": float(ab.replace(",", ".")),
                "k": float(k.replace(",", ".")),
            }
        )

    for raw in text.splitlines():
        line = _PAGE_HEADER.sub("", _PAGE_FOOTER.sub("", raw)).strip()
        if not line or line.startswith(("Municipio", "ANEJO", "COEFICIENTE", "CON ab")):
            pending = ""
            continue
        if match := _PROVINCE.match(line):
            province, pending = PROVINCES[normalise(match["name"])], ""
            continue
        match = _ENTRY.match(line)
        if province is None:
            continue
        if match is None:
            # A wrapped name's first half -- or a region heading (ANDALUCÍA...),
            # which a province heading or the next entry's own line resets.
            pending = line
            continue
        name = f"{pending} {match['name']}".strip() if pending else match["name"]
        pending = ""
        if "CIUDAD DE CEUTA" in name:
            add("51", "CEUTA", match["ab"], match["k"])
        elif "CIUDAD DE MELILLA" in name:
            add("52", "MELILLA", match["ab"], match["k"])
        elif name == "SAN SEBASTIÁN CHIPIONA":
            # Córdoba's "SAN SEBASTIÁN" (wrapped, continued on the next line
            # as "DE LOS BALLESTEROS") ran into Cádiz's "CHIPIONA 0,08 (1,2)".
            add("11", "CHIPIONA", match["ab"], match["k"])
            pending = "SAN SEBASTIÁN"
        else:
            add(province, name, match["ab"], match["k"])
    return pd.DataFrame(rows)


def match_municipalities(
    annex: pd.DataFrame,
    municipalities: pd.DataFrame,
    aliases: dict[tuple[str, str], str] | None = None,
) -> pd.DataFrame:
    """`annex` plus `municipality_code` and `match` ("alias", "exact",
    "fuzzy" or "unmatched"). `municipalities`: ine_code, name."""
    aliases = load_aliases() if aliases is None else aliases
    by_province: dict[str, dict[str, str]] = {}
    for code, name in zip(municipalities["ine_code"], municipalities["name"], strict=True):
        for form in variants(name):
            by_province.setdefault(code[:2], {})[form] = code
    codes, how = [], []
    for province, name in zip(annex["province_code"], annex["ncse_name"], strict=True):
        index = by_province.get(province, {})
        # Aliases first: a 2002 name can collide with a different
        # municipality's current name (URROZ).
        found = next(
            (aliases[(province, f)] for f in variants(name) if (province, f) in aliases), None
        )
        kind = "alias"
        if found is None:
            found = next((index[f] for f in variants(name) if f in index), None)
            kind = "exact"
        if found is None:
            close = difflib.get_close_matches(normalise(name), index, n=1, cutoff=FUZZY_CUTOFF)
            found, kind = (index[close[0]], "fuzzy") if close else (None, "unmatched")
        codes.append(found)
        how.append(kind)
    return annex.assign(municipality_code=codes, match=how)


def by_municipality(matched: pd.DataFrame) -> pd.DataFrame:
    """One row per matched INE code. A few of today's municipalities merged
    several 2002 ones; they keep the highest ab (and its K)."""
    rows = matched.dropna(subset=["municipality_code"]).sort_values("ab_g", ascending=False)
    grouped = rows.groupby("municipality_code", as_index=False)
    return grouped.agg(
        ab_g=("ab_g", "first"),
        k=("k", "first"),
        ncse_names=("ncse_name", lambda names: " | ".join(sorted(names))),
    )


def download_annex_text(dest_dir: Path) -> str:
    pdf = dest_dir / "ncse02.pdf"
    resp = requests.get(BOE_PDF_URL, timeout=120, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    pdf.write_bytes(resp.content)
    out = subprocess.run(
        [
            "pdftotext",
            "-raw",
            "-f",
            str(ANNEX_FIRST_PAGE),
            "-l",
            str(ANNEX_LAST_PAGE),
            str(pdf),
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def build(municipalities_path: str) -> pd.DataFrame:
    """Re-parse the BOE PDF and rewrite the two committed CSVs."""
    municipalities = pd.read_parquet(municipalities_path, columns=["ine_code", "name"])
    with tempfile.TemporaryDirectory() as tmp:
        annex = parse_annex(download_annex_text(Path(tmp)))
    matched = match_municipalities(annex, municipalities)
    matched.rename(columns={"ncse_name": "ncse02_name", "municipality_code": "ine_code"}).to_csv(
        ANNEX_CSV, index=False
    )
    by_municipality(matched).rename(columns={"municipality_code": "ine_code"}).to_csv(
        BY_MUNICIPALITY_CSV, index=False
    )
    return matched


def load_ab_by_municipality(path: Path = BY_MUNICIPALITY_CSV) -> pd.DataFrame:
    """ine_code, ab_g, k (and the NCSE-02 names) for every municipality
    with ab >= 0.04 g. Municipalities not listed have ab < 0.04 g."""
    return pd.read_csv(path, dtype={"ine_code": str})


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m exposure.ncse02 <municipalities.parquet>")
        raise SystemExit(2)
    matched = build(sys.argv[1])
    counts = matched["match"].value_counts().to_dict()
    print(f"NCSE-02 annex: {len(matched)} municipalities with ab >= 0.04 g; matches {counts}")
    unmatched = matched[matched["match"].isin(["unmatched", "fuzzy"])]
    if len(unmatched):
        print(unmatched[["province_code", "ncse_name", "match", "municipality_code"]].to_string())


if __name__ == "__main__":
    main()
