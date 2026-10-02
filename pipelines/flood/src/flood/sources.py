"""The MITECO flood-zone files this pipeline reads, and where they come from.

Two hazards, each a set of zip files, both from MITECO's National Flood
Zone Mapping System (SNCZI):

- **fluvial** (twinFLOOD, ADR-0029): "Zonas Inundables asociadas a periodos
  de retorno", T=10/50/100/500
  (https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html).
- **coastal** (twinCOAST, ADR-0037): "Zonas inundables de origen marino",
  T=100/500 only
  (https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/costas-medio-marino/zi-origen-marino.html).

**Manual download.** Every file sits behind
`gis.miteco.gob.es/descargas/app/DescargaFichero?f=<name>`, which answers
with an ALTCHA proof-of-work captcha page, not the zip. We don't script
around that. The catalogue's other routes were checked on 2026-09-30
(fluvial) and 2026-10-02 (coastal) and none serves these files: the
per-dataset Atom feeds link either back to the HTML page or to the legacy
`mapama.gob.es/app/descargas/descargafichero.aspx` (404), the INSPIRE Atom
services are empty (general) or answer 500 (`CategCostas`), the OGC API
Features endpoints have no flood collections, and the WMS is raster-only
(ADR-0029, ADR-0037). So the zips are downloaded by hand into `raw_dir`
(the file names below are the ones the pages serve), and `check_raw` says
which are missing.

Fluvial: Canarias has no T=10 or T=50 file (the download page doesn't list
them, and the captcha page answers 404 for both names), so Canarias
buildings get NULL, not False, for those two return periods (`exposure.py`).
Coastal: one file per return period covers all of Spain, Canarias, Ceuta
and Melilla included, so nothing is ever unmapped.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

DOWNLOAD_URL = "https://gis.miteco.gob.es/descargas/app/DescargaFichero?f={name}"

# INE province codes of the areas each regional file covers. Anything not
# listed under a region is covered by "PB" (Península + Baleares, incl.
# Ceuta and Melilla); "all" covers every province.
CANARIAS_PROVINCES = ("35", "38")
# Equal-area CRS (ETRS89 / LAEA Europe) that geographic sources are
# repaired and simplified in, so the simplify tolerance is in metres.
METRIC_EPSG = 3035


@dataclass(frozen=True)
class SourceFile:
    return_period: int
    region: str  # "PB" (Península + Baleares), "Canarias" or "all"
    zip_name: str
    # EPSG code the shapefile is in, checked against its .prj on load.
    epsg: int
    # Whether `epsg` is geographic (degrees): such a file is cleaned in
    # METRIC_EPSG instead (zones.py).
    geographic: bool = False

    @property
    def url(self) -> str:
        return DOWNLOAD_URL.format(name=self.zip_name)

    @property
    def work_epsg(self) -> int:
        """The projected CRS zones.py repairs and simplifies this file in."""
        return METRIC_EPSG if self.geographic else self.epsg

    def covers(self, province_code: str) -> bool:
        if self.region == "all":
            return True
        canarias = province_code in CANARIAS_PROVINCES
        return canarias if self.region == "Canarias" else not canarias


@dataclass(frozen=True)
class Hazard:
    """One flood hazard: its files, and how its outputs are named."""

    key: str  # "fluvial" | "coastal" (the CLI's --hazard)
    sources: tuple[SourceFile, ...]
    page_url: str
    # Shapefile attribute naming what each zone studies (a river, a stretch
    # of coast), and the zones.parquet column those names are kept in.
    name_field: str
    label_column: str
    # Prefix of the tile archives and their layers (`<prefix>_zones`,
    # `<prefix>_buildings`) and of the coverage index (`<prefix>_areas.json`).
    tile_prefix: str

    @property
    def return_periods(self) -> tuple[int, ...]:
        return tuple(sorted({s.return_period for s in self.sources}))

    @property
    def flag_columns(self) -> tuple[str, ...]:
        """One per return period. Named `flood_t<rp>` for both hazards: each
        hazard has its own files, and the scenario service reads the same
        column names from either."""
        return tuple(f"flood_t{rp}" for rp in self.return_periods)

    def mapped_return_periods(self, province_code: str) -> tuple[int, ...]:
        """Return periods with a map covering this INE province."""
        return tuple(
            rp
            for rp in self.return_periods
            if any(s.covers(province_code) for s in self.sources if s.return_period == rp)
        )


FLUVIAL = Hazard(
    key="fluvial",
    sources=(
        SourceFile(10, "PB", "laminasPB-q10.zip", 25830),
        # The page links T=50 as `laminas-q50.zip`, not `laminasPB-q50.zip`
        # (both names exist behind the captcha; the page's is the one used).
        SourceFile(50, "PB", "laminas-q50.zip", 25830),
        SourceFile(100, "PB", "laminasPB-q100.zip", 25830),
        SourceFile(500, "PB", "laminasPB-q500.zip", 25830),
        # REGCAN95 / UTM 28N, despite the "_ETRS89" in the shapefile's own name.
        SourceFile(100, "Canarias", "laminasCanarias-q100.zip", 4083),
        SourceFile(500, "Canarias", "laminasCanarias-q500.zip", 4083),
    ),
    page_url="https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html",
    name_field="RIO",
    label_column="rivers",
    tile_prefix="flood",
)

COASTAL = Hazard(
    key="coastal",
    sources=(
        # ETRS89 geographic, all of Spain (Canarias, Ceuta and Melilla
        # included) in one file per period, despite the dataset feeds'
        # "Península Ibérica e Islas Baleares" label. The fluvial page uses
        # the same `laminas-q<rp>.zip` naming for its T=50 file; these two
        # were checked to be coastal (TIPO_ZONA, and every study is "...DEL
        # LITORAL...").
        SourceFile(100, "all", "laminas-q100.zip", 4258, geographic=True),
        SourceFile(500, "all", "laminas-q500.zip", 4258, geographic=True),
    ),
    page_url=(
        "https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/"
        "costas-medio-marino/zi-origen-marino.html"
    ),
    name_field="ZONA",
    label_column="stretches",
    tile_prefix="coast",
)

HAZARDS = {h.key: h for h in (FLUVIAL, COASTAL)}


def check_raw(raw_dir: str | Path, hazard: Hazard = FLUVIAL) -> list[SourceFile]:
    """The files missing from `raw_dir` (or not real zips: a saved captcha
    page is HTML). Empty when everything is there."""
    raw_dir = Path(raw_dir)
    return [s for s in hazard.sources if not zipfile.is_zipfile(raw_dir / s.zip_name)]


def missing_files_message(
    missing: list[SourceFile], raw_dir: str | Path, hazard: Hazard = FLUVIAL
) -> str:
    lines = [
        (
            f"{len(missing)} {hazard.key} flood-zone file(s) missing from {raw_dir}. MITECO serves them "
            "behind a captcha, so download them by hand (a browser, one click each) "
            f"into that directory, keeping the file names. Page: {hazard.page_url}"
        ),
    ]
    lines += [f"  T={s.return_period:<4} {s.region:<9} {s.url}" for s in missing]
    return "\n".join(lines)


def extract(raw_dir: str | Path, source: SourceFile) -> Path:
    """Unzip one source next to its zip (once) and return its .shp path.

    Extracted rather than read through GDAL's /vsizip/: the Península
    shapefiles are 0.9-2GB deflated members, and reading them in parallel
    chunks through /vsizip/ re-inflates from the start of the member for
    every seek."""
    raw_dir = Path(raw_dir)
    dest = raw_dir / Path(source.zip_name).stem
    with zipfile.ZipFile(raw_dir / source.zip_name) as zf:
        shp_names = [n for n in zf.namelist() if n.lower().endswith(".shp")]
        if len(shp_names) != 1:
            raise ValueError(f"{source.zip_name}: expected one .shp, found {shp_names}")
        shp = dest / shp_names[0]
        if not shp.exists():
            zf.extractall(dest)
    return shp
