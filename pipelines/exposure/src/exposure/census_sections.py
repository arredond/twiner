"""INE census sections (secciones censales) + their resident population, and
each building's section -- the demographic layer behind a scenario's
post-event impact estimates (ADR-0024, docs/impact-estimates.md).

Two INE sources, both for the same reference date (1 January 2025) --
section boundaries change every year, so boundaries and population must
come from the same edition or codes stop matching:

- **Boundaries**: INE's "Cartografía digitalizada de secciones censales",
  one national shapefile zip (`seccionado_2025.zip`, EPSG:25830, 36,554
  sections). `CUSEC` is the 10-digit section code (2 province + 3
  municipality + 2 district + 3 section), `CUMUN` its 5-digit INE
  municipality code.
- **Population by age**: the Censo Anual de Población 2021-2025's
  section-level results, "Población por sexo y edad (grupos quinquenales)",
  published as one table per province (`POPULATION_TABLE_IDS`). Each CSV
  carries every year 2021-2025; only 2025 is used. Sections retired before
  2025 appear with an empty 2025 value and are dropped -- after that every
  remaining code matches a 2025 boundary exactly (checked: 36,554/36,554,
  49,128,297 residents).

Building -> section assignment is precomputed once here, per municipality
part (the same "fixed relationship, compute it at ingest, not per request"
reasoning as ADR-0014's `municipality_code`): each part gets a sidecar
`<code>.sites.parquet` holding exactly the columns the scenario engine
queries, plus `census_section_code`, `num_dwellings` and `built_area_m2`.
The durable `*.buildings.parquet` parts themselves are never rewritten.
`compact_sites_for_cloud` then combines the sidecars into the single
spatially-sorted file the scenario service reads.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests
import shapely

from .municipalities import _CATASTRO_CODE_TO_INE

REFERENCE_YEAR = "2025"

BOUNDARIES_URL = f"https://www.ine.es/prodyser/cartografia/seccionado_{REFERENCE_YEAR}.zip"
BOUNDARIES_SHP = f"SECC_CE_{REFERENCE_YEAR}0101.shp"

# jaxiT3 table ids of "Población por sexo y edad (grupos quinquenales)" at
# section level, one per province, found by walking the Censo Anual de
# Población 2021-2025 index (https://www.ine.es/dynt3/inebase/es/index.htm?padre=11555,
# "Resultados de secciones censales por provincias"). Almost all sit in
# one run stepping by 4; Araba/Álava's (65042) is the odd one out, an
# older id INE reused -- it's only reachable from its own province page.
# A new edition gets new ids: re-walk that index, don't guess.
POPULATION_TABLE_IDS = [
    65042, 69097, 69105, 69109, 69113, 69117, 69121, 69125, 69129, 69133, 69137,
    69141, 69145, 69149, 69153, 69157, 69161, 69165, 69169, 69173, 69177, 69181,
    69185, 69189, 69193, 69197, 69201, 69205, 69209, 69213, 69217, 69221, 69225,
    69229, 69233, 69237, 69241, 69245, 69249, 69253, 69257, 69261, 69265, 69269,
    69273, 69277, 69281, 69285, 69289, 69293, 69297, 69345,
]  # fmt: skip
_TABLE_CSV_URL = "https://www.ine.es/jaxiT3/files/t/es/csv_bdsc/{table_id}.csv"

# ine.es serves the requests default User-Agent fine today, but its CDN
# (centrodedescargas.cnig.es, municipalities.py) hasn't always -- same
# browser-like header, for the same reason.
_HEADERS = {"User-Agent": "Mozilla/5.0"}

# "Vulnerable/dependent" population: the dependent age groups of the
# standard age-dependency ratio, under 15 and 65+ (Eurostat's definition;
# INE's own uses <16, which the 5-year groups can't express). Labels exactly
# as they appear in the CSVs.
_UNDER_15_GROUPS = {"De 0 a 4 años", "De 5 a 9 años", "De 10 a 14 años"}
_65_PLUS_GROUPS = {
    "De 65 a 69 años", "De 70 a 74 años", "De 75 a 79 años", "De 80 a 84 años",
    "De 85 a 89 años", "De 90 a 94 años", "De 95 a 99 años", "100 y más años",
}  # fmt: skip
_ALL_AGES = "Todas las edades"

# Equal-area CRS for footprint areas (ETRS89-LAEA Europe) -- covers the
# Canaries too, unlike the UTM 30N the boundaries ship in.
_AREA_CRS = "EPSG:3035"

SITES_SUFFIX = ".sites.parquet"
SITE_COLUMNS = [
    "building_id",
    "centroid_lon",
    "centroid_lat",
    "municipality_code",
    "vs30",
    "census_section_code",
    "num_dwellings",
    "built_area_m2",
]


def download(raw_dir: str | Path, timeout: int = 300) -> tuple[Path, list[Path]]:
    """Download (once; existing files are kept) the boundaries zip and every
    province's population CSV into `raw_dir`. Returns (shapefile path,
    population CSV paths)."""
    import zipfile

    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    zip_path = raw_dir / f"seccionado_{REFERENCE_YEAR}.zip"
    if not zip_path.exists():
        _download(BOUNDARIES_URL, zip_path, timeout)
    shp_path = raw_dir / BOUNDARIES_SHP
    if not shp_path.exists():
        # Extracted flat: the zip's own folder name ("España_Seccionado...")
        # isn't UTF-8-encoded, which macOS's filesystem refuses outright.
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = Path(info.filename).name
                if name.startswith(Path(BOUNDARIES_SHP).stem):
                    (raw_dir / name).write_bytes(zf.read(info))

    csv_dir = raw_dir / "population"
    csv_dir.mkdir(exist_ok=True)
    csv_paths = []
    for table_id in POPULATION_TABLE_IDS:
        path = csv_dir / f"{table_id}.csv"
        if not path.exists():
            _download(_TABLE_CSV_URL.format(table_id=table_id), path, timeout)
        csv_paths.append(path)
    return shp_path, csv_paths


def _download(url: str, dest: Path, timeout: int) -> None:
    resp = requests.get(url, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(resp.content)
    tmp.replace(dest)


def load_population(csv_paths: Iterable[str | Path], year: str = REFERENCE_YEAR) -> pd.DataFrame:
    """Per-section residents for `year`: columns `code`, `population`,
    `pop_under_15`, `pop_65_plus`. Sections with no value for `year`
    (retired before it) are dropped."""
    frames = []
    for path in csv_paths:
        df = pd.read_csv(path, sep=";", dtype=str, encoding="utf-8-sig")
        df = df[(df["Periodo"] == year) & df["Secciones"].notna() & (df["Sexo"] == "Total")]
        df = df[df["Total"].notna()]
        frames.append(df[["Secciones", "Edad", "Total"]])
    df = pd.concat(frames, ignore_index=True)
    df["code"] = df["Secciones"].str[:10]
    # Spanish thousands separator ("1.507").
    df["n"] = df["Total"].str.replace(".", "", regex=False).astype(np.int64)

    def total(groups: set[str]) -> pd.Series:
        return df[df["Edad"].isin(groups)].groupby("code")["n"].sum()

    out = pd.DataFrame({"population": total({_ALL_AGES})})
    out["pop_under_15"] = total(_UNDER_15_GROUPS)
    out["pop_65_plus"] = total(_65_PLUS_GROUPS)
    return out.fillna(0).astype(np.int64).rename_axis("code").reset_index()


def load_sections(shp_path: str | Path) -> gpd.GeoDataFrame:
    """Section polygons in EPSG:4326: `code`, `municipality_code`,
    `municipality_name`, `district`, `section`, geometry."""
    raw = gpd.read_file(shp_path)
    return gpd.GeoDataFrame(
        {
            "code": raw["CUSEC"],
            "municipality_code": raw["CUMUN"],
            "municipality_name": raw["NMUN"],
            "district": raw["CDIS"],
            "section": raw["CSEC"],
        },
        geometry=raw.geometry,
        crs=raw.crs,
    ).to_crs("EPSG:4326")


def assign_sections(
    lon: np.ndarray, lat: np.ndarray, codes: np.ndarray, geoms: np.ndarray
) -> np.ndarray:
    """Each point's containing section code (from `codes`/`geoms`, aligned
    arrays); a point inside none of them (a centroid just past a coastline
    or a boundary drawn slightly differently from Catastro's) gets the
    nearest one instead. Returns an object array of codes, aligned with
    `lon`/`lat`."""
    points = np.asarray(shapely.points(lon, lat))
    tree = shapely.STRtree(geoms)
    result = np.full(len(points), None, dtype=object)
    point_idx, geom_idx = tree.query(points, predicate="within")
    # A point exactly on a shared edge can match twice; keep the first.
    first = np.unique(point_idx, return_index=True)[1]
    result[point_idx[first]] = codes[geom_idx[first]]
    missing = np.flatnonzero(pd.isna(result))
    if len(missing):
        nearest = tree.query_nearest(points[missing], return_distance=False, all_matches=False)
        result[missing[nearest[0]]] = codes[nearest[1]]
    return result


def built_area_m2(
    floor_area_m2: pd.Series, floors: pd.Series, footprint_m2: pd.Series | None
) -> np.ndarray:
    """Total built floor area per building: the cadastral figure where one
    exists (Catastro's INSPIRE `officialArea`, gross floor area over every
    storey), else footprint x storeys. The Foral sources (Basque Country,
    Navarra) publish no floor area at all, hence the fallback."""
    area = pd.to_numeric(floor_area_m2, errors="coerce").astype(float)
    if footprint_m2 is not None:
        storeys = pd.to_numeric(floors, errors="coerce").fillna(1).clip(lower=1)
        fallback = footprint_m2.astype(float) * storeys
        area = area.where(area > 0, fallback)
    return area.fillna(0).to_numpy(dtype=np.float32)


def _candidate_sections(sections: gpd.GeoDataFrame, municipality_code: str) -> gpd.GeoDataFrame:
    """The sections a part's buildings may be assigned to: its own
    municipality's, so section stats always roll up to the same
    municipality. A part whose code has no 2025 sections (municipalities
    merged since the crawl, e.g. Oza dos Ríos + Cesuras -> Oza-Cesuras, or
    Catastro's non-INE office codes) searches its whole province instead,
    or all of Spain if even that is empty."""
    code = _CATASTRO_CODE_TO_INE.get(municipality_code, municipality_code)
    own = sections[sections["municipality_code"] == code]
    if len(own):
        return own
    province = sections[sections["municipality_code"].str[:2] == code[:2]]
    return province if len(province) else sections


def build_site_part(
    part_path: str | Path, out_path: str | Path, codes: np.ndarray, geoms: np.ndarray
) -> int:
    """Write one municipality's `<code>.sites.parquet` from its buildings
    part. Returns the row count."""
    part_path = Path(part_path)
    schema_names = pq.ParquetFile(part_path).schema_arrow.names
    wanted = [
        "building_id", "centroid_lon", "centroid_lat", "municipality_code", "vs30",
        "floors", "floor_area_m2", "num_dwellings",
    ]  # fmt: skip
    df = pd.read_parquet(part_path, columns=[c for c in wanted if c in schema_names])
    for col in wanted:
        if col not in df.columns:
            df[col] = np.nan

    area = pd.to_numeric(df["floor_area_m2"], errors="coerce")
    footprint = None
    if not (area > 0).all():
        geometry = gpd.read_parquet(part_path, columns=["geometry"])
        footprint = geometry.to_crs(_AREA_CRS).area

    table = pa.table(
        {
            "building_id": pa.array(df["building_id"], pa.string()),
            "centroid_lon": df["centroid_lon"].to_numpy(dtype=float),
            "centroid_lat": df["centroid_lat"].to_numpy(dtype=float),
            "municipality_code": pa.array(df["municipality_code"], pa.string()),
            "vs30": pd.to_numeric(df["vs30"], errors="coerce").to_numpy(dtype=float),
            "census_section_code": pa.array(
                assign_sections(
                    df["centroid_lon"].to_numpy(dtype=float),
                    df["centroid_lat"].to_numpy(dtype=float),
                    codes,
                    geoms,
                ),
                pa.string(),
            ),
            "num_dwellings": pd.to_numeric(df["num_dwellings"], errors="coerce")
            .fillna(0)
            .clip(lower=0)
            .to_numpy(dtype=np.int32),
            "built_area_m2": built_area_m2(df["floor_area_m2"], df["floors"], footprint),
        }
    )
    out_path = Path(out_path)
    tmp = out_path.with_name(out_path.name + ".tmp")
    pq.write_table(table, tmp)
    tmp.replace(out_path)
    return table.num_rows


def _build_one(args: tuple[Path, Path, np.ndarray, np.ndarray]) -> tuple[str, int, str | None]:
    part_path, out_path, codes, geoms = args
    try:
        return part_path.name, build_site_part(part_path, out_path, codes, geoms), None
    except Exception as e:  # noqa: BLE001 -- one municipality's failure shouldn't kill the run
        return part_path.name, 0, f"{type(e).__name__}: {e}"


def build_site_parts(
    parts_dir: str | Path, sections: gpd.GeoDataFrame, max_workers: int | None = None
) -> list[tuple[str, int, str | None]]:
    """A `<code>.sites.parquet` next to every `<code>.buildings.parquet` in
    `parts_dir`. Resumable: a part whose sidecar already exists is skipped
    (delete the sidecars to force a rebuild -- they're cheap, minutes
    nationally, unlike debris)."""
    parts_dir = Path(parts_dir)
    tasks = []
    for part_path in sorted(parts_dir.glob("*.buildings.parquet")):
        code = part_path.name.split(".", 1)[0]
        out_path = parts_dir / f"{code}{SITES_SUFFIX}"
        if out_path.exists():
            continue
        candidates = _candidate_sections(sections, code)
        tasks.append(
            (
                part_path,
                out_path,
                candidates["code"].to_numpy(dtype=object),
                candidates.geometry.to_numpy(),
            )
        )

    results = []
    t0 = time.monotonic()
    with ProcessPoolExecutor(max_workers=max_workers or os.cpu_count()) as pool:
        futures = [pool.submit(_build_one, task) for task in tasks]
        for i, future in enumerate(as_completed(futures), 1):
            name, n, error = future.result()
            results.append((name, n, error))
            if error:
                print(f"  FAILED {name}: {error}")
            if i % 500 == 0 or i == len(futures):
                print(f"  {i}/{len(futures)} parts, {time.monotonic() - t0:.0f}s")
    return results


def section_building_totals(sites_glob: str) -> pd.DataFrame:
    """Per-section `n_buildings`, `n_dwellings`, `built_area_m2`, over every
    building in the sidecars -- the static denominators impact estimates
    divide by."""
    import duckdb

    return duckdb.execute(
        """
        SELECT census_section_code AS code,
               COUNT(*) AS n_buildings,
               SUM(num_dwellings)::BIGINT AS n_dwellings,
               SUM(built_area_m2) AS built_area_m2
        FROM read_parquet(?)
        WHERE census_section_code IS NOT NULL
        GROUP BY 1
        """,
        [sites_glob],
    ).df()


def build_sections_table(
    sections: gpd.GeoDataFrame, population: pd.DataFrame, totals: pd.DataFrame
) -> gpd.GeoDataFrame:
    """Boundaries + population + building totals, one row per section, plus
    its bbox (the sidebar zooms to a clicked section, and the service's
    sections_meta has no geometry)."""
    out = sections.merge(population, on="code", how="left").merge(totals, on="code", how="left")
    for col in ["population", "pop_under_15", "pop_65_plus", "n_buildings", "n_dwellings"]:
        out[col] = out[col].fillna(0).astype(np.int64)
    out["built_area_m2"] = out["built_area_m2"].fillna(0.0)
    bounds = out.geometry.bounds
    out["bbox_xmin"], out["bbox_ymin"] = bounds["minx"], bounds["miny"]
    out["bbox_xmax"], out["bbox_ymax"] = bounds["maxx"], bounds["maxy"]
    return gpd.GeoDataFrame(out, geometry="geometry", crs=sections.crs)


def build_municipalities_table(sections_table: gpd.GeoDataFrame) -> pd.DataFrame:
    """Per-municipality rollup of `build_sections_table`, plus a bbox
    (sidebar zoom-to) -- sections tile each municipality exactly, so their
    union's extent is the municipality's."""
    bounds = sections_table.geometry.bounds
    df = pd.concat([sections_table.drop(columns="geometry"), bounds], axis=1)
    return (
        df.groupby("municipality_code")
        .agg(
            name=("municipality_name", "first"),
            population=("population", "sum"),
            pop_under_15=("pop_under_15", "sum"),
            pop_65_plus=("pop_65_plus", "sum"),
            n_buildings=("n_buildings", "sum"),
            n_dwellings=("n_dwellings", "sum"),
            built_area_m2=("built_area_m2", "sum"),
            n_sections=("code", "count"),
            bbox_xmin=("minx", "min"),
            bbox_ymin=("miny", "min"),
            bbox_xmax=("maxx", "max"),
            bbox_ymax=("maxy", "max"),
        )
        .reset_index()
    )


def compact_sites_for_cloud(parts_dir: str | Path, output: str | Path) -> int:
    """Every `*.sites.parquet` sidecar combined into one file, sorted by
    centroid for row-group pruning -- the same layout and reasoning as
    `region.compact_buildings_for_cloud` (see its docstring), with the
    impact columns added. Returns the row count written."""
    import duckdb

    con = duckdb.connect()
    output = str(output)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    columns = ", ".join(SITE_COLUMNS)
    # Interpolated, not bound: DuckDB's COPY takes no parameter for the
    # target. `output` is a local CLI argument, never web input.
    con.execute(
        f"""
        COPY (
            SELECT {columns}
            FROM read_parquet(?)
            ORDER BY centroid_lon, centroid_lat
        ) TO '{output}' (FORMAT PARQUET, ROW_GROUP_SIZE 200000)
        """,
        [str(Path(parts_dir) / f"*{SITES_SUFFIX}")],
    )
    row = con.execute("SELECT COUNT(*) FROM read_parquet(?)", [output]).fetchone()
    assert row is not None
    return row[0]
