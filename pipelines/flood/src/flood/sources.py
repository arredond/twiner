"""The MITECO flood-zone files this pipeline reads, and where they come from.

Source: MITECO's National Flood Zone Mapping System (SNCZI), "Zonas
Inundables asociadas a periodos de retorno", fluvial flooding only
(https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html).
Coastal flooding ("origen marino") is a separate dataset, not used yet (see
ADR-0030).

**Manual download.** Every file sits behind
`gis.miteco.gob.es/descargas/app/DescargaFichero?f=<name>`, which answers
with an ALTCHA proof-of-work captcha page, not the zip. We don't script
around that. The catalogue's other routes were all checked on 2026-09-30
and none serves these files: the per-dataset Atom feeds only link back to
the HTML page, the INSPIRE Atom service has no entries, the OGC API Features
endpoint has no flood collections, and the WMS is raster-only (ADR-0029).
So the zips are downloaded by hand into `raw_dir` (the file names below are
the ones the page serves), and `check_raw` says which are missing.

Canarias has no T=10 or T=50 file: the download page doesn't list them, and
the captcha page answers 404 for both names. Canarias buildings therefore
get NULL, not False, for those two return periods (see `exposure.py`).
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

DOWNLOAD_URL = "https://gis.miteco.gob.es/descargas/app/DescargaFichero?f={name}"
PAGE_URL = "https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html"

RETURN_PERIODS = (10, 50, 100, 500)

# INE province codes of the areas each file covers. Anything not listed
# under a region is covered by "PB" (Península + Baleares, incl. Ceuta and
# Melilla).
CANARIAS_PROVINCES = ("35", "38")


@dataclass(frozen=True)
class SourceFile:
    return_period: int
    region: str  # "PB" (Península + Baleares) or "Canarias"
    zip_name: str
    # EPSG code the shapefile is in, checked against its .prj on load.
    epsg: int

    @property
    def url(self) -> str:
        return DOWNLOAD_URL.format(name=self.zip_name)


SOURCES = (
    SourceFile(10, "PB", "laminasPB-q10.zip", 25830),
    # The page links T=50 as `laminas-q50.zip`, not `laminasPB-q50.zip`
    # (both names exist behind the captcha; the page's is the one used).
    SourceFile(50, "PB", "laminas-q50.zip", 25830),
    SourceFile(100, "PB", "laminasPB-q100.zip", 25830),
    SourceFile(500, "PB", "laminasPB-q500.zip", 25830),
    # REGCAN95 / UTM 28N, despite the "_ETRS89" in the shapefile's own name.
    SourceFile(100, "Canarias", "laminasCanarias-q100.zip", 4083),
    SourceFile(500, "Canarias", "laminasCanarias-q500.zip", 4083),
)


def mapped_return_periods(province_code: str) -> tuple[int, ...]:
    """Return periods with a flood-zone map covering this INE province."""
    regions = {"Canarias" if province_code in CANARIAS_PROVINCES else "PB"}
    return tuple(s.return_period for s in SOURCES if s.region in regions)


def check_raw(raw_dir: str | Path) -> list[SourceFile]:
    """The files missing from `raw_dir` (or not real zips: a saved captcha
    page is HTML). Empty when everything is there."""
    raw_dir = Path(raw_dir)
    return [s for s in SOURCES if not zipfile.is_zipfile(raw_dir / s.zip_name)]


def missing_files_message(missing: list[SourceFile], raw_dir: str | Path) -> str:
    lines = [
        (
            f"{len(missing)} flood-zone file(s) missing from {raw_dir}. MITECO serves them "
            "behind a captcha, so download them by hand (a browser, one click each) "
            f"into that directory, keeping the file names. Page: {PAGE_URL}"
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
