"""Critical infrastructure from IGN's Base Topográfica Nacional (ADR-0025).

One table of assets -- facilities that are buildings (hospitals, schools,
care homes, emergency services) and non-building infrastructure
(substations, power plants, bridges, dams) -- each with a representative
point, its municipality and Vs30, so the scenario service can evaluate
ground motion at it the same way it does for buildings.

Source: three BTN theme GeoPackages (CC BY 4.0, IGN/CNIG), downloaded by
hand from https://centrodedescargas.cnig.es/CentroDescargas/btn into
`data/infrastructure/raw/` -- CNIG refuses scripted downloads (ADR-0025).
Layer codes and attribute values are from IGN's BTN specification
(ESPBTN.pdf). BTN stores type attributes as bare codes ("04"), not the
"04 HOSPITAL" labels its vector tiles show.

Facilities are also matched to the Catastro building they sit on
(`match_facility_buildings`), so the scenario can report that building's
own damage state -- the same model as every other building, not a
separate one. Non-building assets only ever get an intensity.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import duckdb
import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from . import vs30 as vs30_mod

RAW_FILES = {
    "servicios": "BTN_T_servicios_instalaciones.gpkg",
    "energia": "BTN_T_energia.gpkg",
    "construcciones": "BTN_T_construcciones.gpkg",
}
DOWNLOAD_PAGE = "https://centrodedescargas.cnig.es/CentroDescargas/btn"

# 0590P "Servicios e instalaciones" TIPO_0590 -> (category, subtype). Only
# the types ADR-0025's first release covers; the rest of the layer (museums,
# town halls, farms...) is ignored.
FACILITY_TYPES = {
    "01": ("education", "school"),
    "02": ("education", "university"),
    "04": ("health", "hospital"),
    "05": ("health", "health_centre"),
    "06": ("care", "care_home"),
    "21": ("emergency", "police"),
    "22": ("emergency", "fire_civil_protection"),
}

# 0713S "Central eléctrica" TIPO_0713 -> subtype (every type is kept).
POWER_PLANT_TYPES = {
    "01": "thermal",
    "02": "hydro",
    "03": "nuclear",
    "05": "solar_pv",
    "06": "combined_cycle",
    "07": "wind",
    "08": "solar_thermal",
}

# 0710L TENSI_0710 -> label. Only used to describe a substation (the
# highest-voltage line reaching it), not for any model.
LINE_VOLTAGES = {"01": "<100 kV", "02": "100-150 kV", "03": "220 kV", "04": "400 kV"}

# How far a substation polygon and a power line's end may be apart and
# still count as connected -- BTN requires lines to end on the substation,
# this only absorbs digitizing slop.
SUBSTATION_LINE_TOLERANCE_M = 30.0

# A facility point further than this from every Catastro footprint is kept
# as a point asset with no building (intensity only), not forced onto a
# neighbour.
FACILITY_MATCH_MAX_M = 30.0

# First zoom each category is drawn at (tippecanoe per-feature minzoom).
# Few, high-value assets from national view; dense ones only once zoomed
# in (165k bridges at z6 would be noise and a heavy tile).
CATEGORY_MINZOOM = {
    "health": 5,
    "power": 5,
    "dam": 5,
    "emergency": 7,
    "care": 7,
    "education": 9,
    "bridge": 10,
}

_M_PER_DEG_LAT = 111_320.0

# The columns the scenario service reads (infrastructure_sites.parquet).
SITE_COLUMNS = [
    "asset_id",
    "category",
    "subtype",
    "name",
    "lon",
    "lat",
    "municipality_code",
    "vs30",
    "building_id",
]


def raw_paths(raw_dir: str | Path) -> dict[str, Path]:
    """The three theme GeoPackages, or a FileNotFoundError saying where to
    get them."""
    raw_dir = Path(raw_dir)
    paths = {key: raw_dir / name for key, name in RAW_FILES.items()}
    missing = [p.name for p in paths.values() if not p.exists()]
    if missing:
        raise FileNotFoundError(
            f"missing BTN GeoPackages in {raw_dir}: {', '.join(missing)}. Download the "
            f"'BTN Tema - ...' GeoPackage rows from {DOWNLOAD_PAGE} and unzip them there "
            "(see docs/decisions/0025-critical-infrastructure.md)."
        )
    return paths


def _read(path: Path, layer: str, where: str | None = None) -> gpd.GeoDataFrame:
    # BTN's `id` is each table's GeoPackage primary key (its FID), which the
    # reader turns into the row index rather than a column.
    gdf = gpd.read_file(path, layer=layer, where=where, fid_as_index=True)
    gdf["id"] = gdf.index
    # BTN is ETRS89 (EPSG:4258); the rest of the project is WGS84 lon/lat.
    # The two differ by well under a metre, but label it honestly.
    return gdf.to_crs(4326)


def _text(series: pd.Series) -> pd.Series:
    """Empty strings as missing, so `name`/`registry_id` are null, not ''."""
    return series.mask(series.isna() | (series.astype(str).str.strip() == ""))


def load_facilities(path: Path) -> gpd.GeoDataFrame:
    codes = ",".join(f"'{c}'" for c in FACILITY_TYPES)
    gdf = _read(path, "btn0590p_ser_ins", where=f"tipo_0590 IN ({codes})")
    kind = gdf["tipo_0590"].map(FACILITY_TYPES)
    # CNH id for hospitals/health centres, RCD/RUCT id for schools and
    # universities -- whichever the point carries.
    registry = _text(gdf["id_hos"]).fillna(_text(gdf["id_edu"]))
    return gpd.GeoDataFrame(
        {
            "asset_id": gdf["id"].astype("int64"),
            "category": kind.str[0],
            "subtype": kind.str[1],
            "name": _text(gdf["nombre"]),
            "registry_id": registry,
            "detail": None,
            "geometry": gdf.geometry,
        },
        crs=4326,
    )


def load_substations(path: Path) -> gpd.GeoDataFrame:
    subs = _read(path, "btn0719s_tra_elec", where="tipo_0719 = '01'")
    lines = _read(path, "btn0710l_lin_elec")
    voltage = _substation_voltage(subs, lines)
    return gpd.GeoDataFrame(
        {
            "asset_id": subs["id"].astype("int64"),
            "category": "power",
            "subtype": "substation",
            "name": _text(subs["nombre"]),
            "registry_id": None,
            "detail": voltage.map(LINE_VOLTAGES),
            "geometry": subs.geometry,
        },
        crs=4326,
    )


def _substation_voltage(subs: gpd.GeoDataFrame, lines: gpd.GeoDataFrame) -> pd.Series:
    """Highest TENSI_0710 code among lines within the tolerance of each
    substation (codes sort in voltage order), or NaN when none is."""
    # Metric CRS for the buffer: ETRS89 / UTM 30N is fine for a 30 m
    # tolerance anywhere in Spain (Canarias included -- distortion at that
    # scale is negligible for "does this line touch it").
    subs_m = subs.to_crs(25830)
    lines_m = lines.to_crs(25830)[["tensi_0710", "geometry"]]
    buffered = subs_m[["id"]].set_geometry(subs_m.buffer(SUBSTATION_LINE_TOLERANCE_M))
    hits = gpd.sjoin(buffered, lines_m, predicate="intersects", how="inner")
    best = hits.groupby("id")["tensi_0710"].max()
    return subs["id"].map(best)


def load_power_plants(path: Path) -> gpd.GeoDataFrame:
    gdf = _read(path, "btn0713s_cen_elec")
    return gpd.GeoDataFrame(
        {
            "asset_id": gdf["id"].astype("int64"),
            "category": "power",
            "subtype": gdf["tipo_0713"].map(POWER_PLANT_TYPES).fillna("other_plant"),
            "name": _text(gdf["nombre"]),
            "registry_id": None,
            "detail": None,
            "geometry": gdf.geometry,
        },
        crs=4326,
    )


def load_bridges(path: Path) -> gpd.GeoDataFrame:
    # TIPO 02 = puente (04 pasarela and 05 vado are footbridges and fords);
    # ESTAD 01 = in use (not under construction or ruined).
    gdf = _read(path, "btn0546l_pas_ele", where="tipo_0546 = '02' AND estad_0546 = '01'")
    length_m = gdf.to_crs(25830).length.round()
    return gpd.GeoDataFrame(
        {
            "asset_id": gdf["id"].astype("int64"),
            "category": "bridge",
            "subtype": "bridge",
            "name": _text(gdf["nombre"]),
            "registry_id": None,
            "detail": length_m.map(lambda m: f"{m:.0f} m"),
            "geometry": gdf.geometry,
        },
        crs=4326,
    )


def load_dams(path: Path) -> gpd.GeoDataFrame:
    # Only dams in MITECO's national inventory (Inventario de Presas y
    # Embalses, ID_PRESA set): 1,533 of 28,213. BTN also captures every pond
    # and irrigation-reservoir embankment as a "presa"; those aren't what
    # "dam" means to an emergency planner, and would drown the real ones.
    gdf = _read(path, "btn0552l_presa", where="id_presa IS NOT NULL AND id_presa <> ''")
    return gpd.GeoDataFrame(
        {
            "asset_id": gdf["id"].astype("int64"),
            "category": "dam",
            "subtype": "dam",
            "name": _text(gdf["nombre"]),
            "registry_id": _text(gdf["id_presa"]),
            "detail": None,
            "geometry": gdf.geometry,
        },
        crs=4326,
    )


def load_assets(raw_dir: str | Path) -> gpd.GeoDataFrame:
    paths = raw_paths(raw_dir)
    assets = pd.concat(
        [
            load_facilities(paths["servicios"]),
            load_substations(paths["energia"]),
            load_power_plants(paths["energia"]),
            load_bridges(paths["construcciones"]),
            load_dams(paths["construcciones"]),
        ],
        ignore_index=True,
    )
    assets = gpd.GeoDataFrame(assets, geometry="geometry", crs=4326)
    # BTN geometries carry elevation (Z); nothing downstream uses it.
    assets["geometry"] = shapely.force_2d(assets.geometry.values)
    assets = assets[assets.geometry.notna() & ~assets.geometry.is_empty].reset_index(drop=True)
    if not assets["asset_id"].is_unique:
        # BTN ids are unique across layers today (checked: 287,472 ids over
        # the five layers, all distinct). Every feature-state and result
        # join keys on it, so fail loudly rather than silently coalesce.
        dupes = assets.loc[assets["asset_id"].duplicated(), "asset_id"].head().tolist()
        raise ValueError(f"BTN ids are not unique across layers, e.g. {dupes}")
    # One representative point per asset: where its intensity is evaluated
    # and where its map marker goes. It stays inside a
    # polygon (a centroid of an L-shaped plant may not) and on a line --
    # `representative_point` is GEOS's PointOnSurface.
    points = assets.geometry.representative_point()
    assets["lon"] = points.x
    assets["lat"] = points.y
    return assets


def assign_municipality(assets: gpd.GeoDataFrame, municipalities_path: str | Path) -> pd.Series:
    """INE municipality code of each asset's representative point (IGN
    boundaries, the same `ine_code` the map's municipality layer uses).
    Points in the sea just off the coast (a pier, a dam's far end) take the
    nearest municipality within 1 km."""
    munis = gpd.read_parquet(municipalities_path, columns=["ine_code", "geometry"]).to_crs(25830)
    points = gpd.GeoDataFrame(
        {"asset_id": assets["asset_id"]},
        geometry=gpd.points_from_xy(assets["lon"], assets["lat"]),
        crs=4326,
    ).to_crs(25830)
    joined = gpd.sjoin_nearest(points, munis, how="left", max_distance=1000)
    # Border points equidistant from two polygons come back twice.
    joined = joined[~joined.index.duplicated(keep="first")]
    return joined["ine_code"].reindex(points.index)


def assign_vs30(assets: gpd.GeoDataFrame, grid: pd.DataFrame) -> np.ndarray:
    return vs30_mod.lookup_vs30(assets["lon"].to_numpy(), assets["lat"].to_numpy(), grid)


# Cell size for the facility -> building candidate search. Candidates come
# from the 3x3 cells around a facility, so any building whose *centroid* is
# within one cell (~450 m) is considered -- enough for a hospital block
# whose main building's centroid sits well away from BTN's point.
_MATCH_CELL_DEG = 0.005


def match_facility_buildings(facilities: pd.DataFrame, buildings_glob: str) -> pd.DataFrame:
    """For each facility point, the Catastro building whose footprint
    contains it, or else the nearest footprint within FACILITY_MATCH_MAX_M.

    Returns asset_id, building_id, match ('inside' | 'nearest'), distance_m.
    Facilities with no building that close are absent.

    A plain lon/lat range join would make DuckDB compare each point with
    every building in a whole longitude strip of Spain; bucketing both
    sides into cells and equi-joining on the cell key keeps candidates
    local.
    """
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.register("f", facilities[["asset_id", "lon", "lat"]])
    return con.execute(
        f"""
        WITH fc AS (
            SELECT asset_id, lon, lat,
                   CAST(floor(lon / {_MATCH_CELL_DEG}) AS BIGINT) + dx AS cx,
                   CAST(floor(lat / {_MATCH_CELL_DEG}) AS BIGINT) + dy AS cy
            FROM f, (SELECT unnest([-1, 0, 1]) AS dx), (SELECT unnest([-1, 0, 1]) AS dy)
        ),
        b AS (
            SELECT building_id, geometry,
                   CAST(floor(centroid_lon / {_MATCH_CELL_DEG}) AS BIGINT) AS cx,
                   CAST(floor(centroid_lat / {_MATCH_CELL_DEG}) AS BIGINT) AS cy
            FROM read_parquet(?)
        ),
        cand AS (
            SELECT fc.asset_id, b.building_id,
                   ST_Contains(b.geometry, ST_Point(fc.lon, fc.lat)) AS inside,
                   -- Degrees -> metres, scaling longitude by cos(lat):
                   -- accurate to well under a metre at 30 m.
                   ST_Distance(
                       ST_Point(fc.lon * cos(radians(fc.lat)), fc.lat),
                       ST_Affine(b.geometry, cos(radians(fc.lat)), 0, 0, 1, 0, 0)
                   ) * {_M_PER_DEG_LAT} AS distance_m
            FROM fc JOIN b USING (cx, cy)
        )
        SELECT asset_id, building_id,
               CASE WHEN inside THEN 'inside' ELSE 'nearest' END AS match,
               round(distance_m, 1) AS distance_m
        FROM cand
        WHERE inside OR distance_m <= {FACILITY_MATCH_MAX_M}
        QUALIFY row_number() OVER (
            PARTITION BY asset_id ORDER BY inside DESC, distance_m, building_id
        ) = 1
        """,
        [buildings_glob],
    ).df()


def build_assets_table(
    raw_dir: str | Path,
    municipalities_path: str | Path,
    buildings_glob: str,
    vs30_grid: pd.DataFrame,
) -> gpd.GeoDataFrame:
    assets = load_assets(raw_dir)
    assets["municipality_code"] = assign_municipality(assets, municipalities_path).to_numpy()
    # BTN's map sheets run past the border: ~2,260 features (almost all
    # bridges) sit in France, Andorra or Portugal, more than 1 km from any
    # Spanish municipality. They aren't Spanish infrastructure; drop them.
    assets = assets[assets["municipality_code"].notna()].reset_index(drop=True)
    # NaN where ESRM20 has no point nearby -- the whole of Canarias (its
    # Spain grid doesn't cover the islands) and holes such as reservoirs,
    # which is where many bridges are. The scenario service falls back to
    # DEFAULT_VS30 for these, exactly as it does for buildings.
    assets["vs30"] = assign_vs30(assets, vs30_grid)
    facility_rows = assets["category"].isin({c for c, _ in FACILITY_TYPES.values()})
    matches = match_facility_buildings(assets.loc[facility_rows], buildings_glob)
    assets = assets.merge(matches, on="asset_id", how="left")
    return gpd.GeoDataFrame(assets, geometry="geometry", crs=4326)


def write_vs30_sites(grid: pd.DataFrame, output_path: str | Path) -> Path:
    """ESRM20's Vs30 point grid as a small parquet the scenario service
    loads once, for the intensity-band grid (whose cells aren't buildings,
    so have no precomputed Vs30 of their own)."""
    output_path = Path(output_path)
    grid[["lon", "lat", "vs30"]].astype("float32").to_parquet(output_path, index=False)
    return output_path


def tile_assets(assets: gpd.GeoDataFrame, output_path: str | Path) -> Path:
    """infrastructure.pmtiles, two layers keyed by `asset_id`:

    - `points`: every asset's representative point -- the marker layer,
      and what feature-state colours after a run.
    - `shapes`: the real geometry of polygon/line assets (plants,
      substations, bridges, dams), drawn from z12 where it's visible.

    Each category starts at its own zoom (CATEGORY_MINZOOM) via tippecanoe's
    per-feature `tippecanoe.minzoom`, rather than tippecanoe dropping
    features by density -- a dropped hospital would be a wrong answer.
    """
    if shutil.which("tippecanoe") is None:
        raise RuntimeError("tippecanoe not found on PATH (brew install tippecanoe)")
    output_path = Path(output_path)
    props = ["asset_id", "category", "subtype", "name", "detail", "registry_id", "building_id"]
    with tempfile.TemporaryDirectory() as tmp:
        points_path = Path(tmp) / "points.geojsonl"
        shapes_path = Path(tmp) / "shapes.geojsonl"
        with points_path.open("w") as pf, shapes_path.open("w") as sf:
            records = assets[[*props, "lon", "lat"]].to_dict("records")
            for record, geometry in zip(records, assets.geometry.array, strict=True):
                properties = {k: record[k] for k in props if not pd.isna(record[k])}
                properties["asset_id"] = int(record["asset_id"])
                minzoom = CATEGORY_MINZOOM[str(record["category"])]
                lon, lat = float(record["lon"]), float(record["lat"])
                point = {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}
                pf.write(_feature(point, properties, minzoom) + "\n")
                if geometry.geom_type != "Point":
                    shape = shapely.geometry.mapping(geometry)
                    sf.write(_feature(shape, properties, max(minzoom, 12)) + "\n")
        subprocess.run(
            [
                "tippecanoe",
                "-o",
                str(output_path),
                "--force",
                "-Z5",
                "-z14",
                "--no-feature-limit",
                "--no-tile-size-limit",
                "--use-attribute-for-id=asset_id",
                "-L",
                json.dumps({"file": str(points_path), "layer": "points"}),
                "-L",
                json.dumps({"file": str(shapes_path), "layer": "shapes"}),
            ],
            check=True,
        )
    return output_path


def _feature(geometry: dict, properties: dict, minzoom: int) -> str:
    return json.dumps(
        {
            "type": "Feature",
            "tippecanoe": {"minzoom": minzoom},
            "properties": properties,
            "geometry": geometry,
        },
        ensure_ascii=False,
        default=_json_default,
    )


def _json_default(value):
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    raise TypeError(f"not JSON serializable: {type(value)}")
