"""Province and CCAA boundaries plus a search index of every admin area,
for the flood mode's area picker (ADR-0029).

Provinces and CCAA are dissolved from the IGN municipality polygons the
choropleth already uses (municipalities.py), not downloaded separately, so
all three levels share exactly the same edges. Province = first two digits
of the INE municipality code; CCAA from INE's fixed province -> CCAA table
below.

IGN also lists 88 shared territories ("condominios", codes 53xxx/54xxx: land
two or more municipalities own jointly, e.g. Bardenas Reales) that belong to
no single municipality or province and hold no buildings. They're assigned
to the province they share the longest border with, so province outlines
don't have holes; they're left out of the municipality search index.

Outputs:
- `admin_areas.pmtiles`: layers `ccaa` and `province`, each feature with
  `code` and `name`. Municipalities are already in municipalities.pmtiles.
- `admin_index.json`: every CCAA, province and municipality, what the
  frontend's search box searches. Compact, one array per level:
  `{"ccaa": [[code, name, w, s, e, n]], "province": [[code, name, ccaa_code,
  w, s, e, n]], "municipality": [[code, name, w, s, e, n]]}` (a
  municipality's province is its code's first two digits).
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

# INE CCAA codes and names (INE "Relación de comunidades y ciudades
# autónomas con sus códigos"), with their provinces. Kept in sync by hand
# with services/scenario's admin_areas.py.
CCAA: dict[str, tuple[str, tuple[str, ...]]] = {
    "01": ("Andalucía", ("04", "11", "14", "18", "21", "23", "29", "41")),
    "02": ("Aragón", ("22", "44", "50")),
    "03": ("Principado de Asturias", ("33",)),
    "04": ("Illes Balears", ("07",)),
    "05": ("Canarias", ("35", "38")),
    "06": ("Cantabria", ("39",)),
    "07": ("Castilla y León", ("05", "09", "24", "34", "37", "40", "42", "47", "49")),
    "08": ("Castilla-La Mancha", ("02", "13", "16", "19", "45")),
    "09": ("Cataluña", ("08", "17", "25", "43")),
    "10": ("Comunitat Valenciana", ("03", "12", "46")),
    "11": ("Extremadura", ("06", "10")),
    "12": ("Galicia", ("15", "27", "32", "36")),
    "13": ("Comunidad de Madrid", ("28",)),
    "14": ("Región de Murcia", ("30",)),
    "15": ("Comunidad Foral de Navarra", ("31",)),
    "16": ("País Vasco", ("01", "20", "48")),
    "17": ("La Rioja", ("26",)),
    "18": ("Ceuta", ("51",)),
    "19": ("Melilla", ("52",)),
}

# INE province names, in their usual display order ("A Coruña", not INE's
# sortable "Coruña, A").
PROVINCES: dict[str, str] = {
    "01": "Araba/Álava", "02": "Albacete", "03": "Alicante/Alacant", "04": "Almería",
    "05": "Ávila", "06": "Badajoz", "07": "Illes Balears", "08": "Barcelona",
    "09": "Burgos", "10": "Cáceres", "11": "Cádiz", "12": "Castellón/Castelló",
    "13": "Ciudad Real", "14": "Córdoba", "15": "A Coruña", "16": "Cuenca",
    "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa",
    "21": "Huelva", "22": "Huesca", "23": "Jaén", "24": "León", "25": "Lleida",
    "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Málaga", "30": "Murcia",
    "31": "Navarra", "32": "Ourense", "33": "Asturias", "34": "Palencia",
    "35": "Las Palmas", "36": "Pontevedra", "37": "Salamanca",
    "38": "Santa Cruz de Tenerife", "39": "Cantabria", "40": "Segovia", "41": "Sevilla",
    "42": "Soria", "43": "Tarragona", "44": "Teruel", "45": "Toledo",
    "46": "Valencia/València", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora",
    "50": "Zaragoza", "51": "Ceuta", "52": "Melilla",
}  # fmt: skip

PROVINCE_TO_CCAA = {p: c for c, (_, provinces) in CCAA.items() for p in provinces}

# Simplification for the province/CCAA outlines (degrees, ~20m): they're
# drawn as a highlight, not used for any computation.
SIMPLIFY_DEG = 0.0002


def assign_provinces(municipalities: gpd.GeoDataFrame) -> pd.Series:
    """Province code per row, shared territories included (module docstring)."""
    province = municipalities["ine_code"].str[:2]
    shared = ~province.isin(list(PROVINCES))
    regular = municipalities[~shared]
    tree = shapely.STRtree(regular.geometry.values)
    boundaries = shapely.boundary(regular.geometry.values)
    for i in np.flatnonzero(shared.to_numpy()):
        geom = municipalities.geometry.iloc[i]
        near = tree.query(geom, predicate="intersects")
        if not len(near):
            continue
        shared_len = shapely.length(shapely.intersection(boundaries[near], geom.boundary))
        province.iloc[int(i)] = regular["ine_code"].iloc[int(near[np.argmax(shared_len)])][:2]
    return province


def build_admin_areas(
    municipalities_path: str | Path,
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, dict[str, list[list]]]:
    munis = gpd.read_parquet(municipalities_path, columns=["ine_code", "name", "geometry"])
    # IGN ships ETRS89 (EPSG:4258); tippecanoe expects WGS84 (the same
    # coordinates to within a metre, so relabelled, not reprojected).
    munis = munis.set_crs(4326, allow_override=True)
    munis["province"] = assign_provinces(munis)
    munis = munis[munis["province"].isin(list(PROVINCES))]
    munis["ccaa"] = munis["province"].map(PROVINCE_TO_CCAA)

    provinces = munis.dissolve(by="province").reset_index()[["province", "geometry"]]
    provinces = provinces.rename(columns={"province": "code"})
    provinces["name"] = provinces["code"].map(PROVINCES)
    provinces["parent"] = provinces["code"].map(PROVINCE_TO_CCAA)
    ccaa = provinces.dissolve(by="parent").reset_index()[["parent", "geometry"]]
    ccaa = ccaa.rename(columns={"parent": "code"})
    ccaa["name"] = ccaa["code"].map(lambda c: CCAA[c][0])
    for frame in (provinces, ccaa):
        frame["geometry"] = shapely.simplify(frame.geometry.values, SIMPLIFY_DEG)

    index: dict[str, list[list]] = {"ccaa": [], "province": [], "municipality": []}
    for row, bounds in zip(ccaa.itertuples(), shapely.bounds(ccaa.geometry.values)):
        index["ccaa"].append([row.code, row.name, *_bbox(bounds)])
    for row, bounds in zip(provinces.itertuples(), shapely.bounds(provinces.geometry.values)):
        index["province"].append([row.code, row.name, row.parent, *_bbox(bounds)])
    regular = munis[munis["ine_code"].str[:2] == munis["province"]]
    for row, bounds in zip(regular.itertuples(), shapely.bounds(regular.geometry.values)):
        index["municipality"].append([row.ine_code, row.name, *_bbox(bounds)])
    return ccaa, provinces, index


def _bbox(bounds: np.ndarray) -> list[float]:
    """[west, south, east, north] to 3 decimals (~100m): only used to fit
    the map to an area."""
    return [round(float(v), 3) for v in bounds]


def write_admin_areas(municipalities_path: str | Path, out_dir: str | Path) -> tuple[Path, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ccaa, provinces, index = build_admin_areas(municipalities_path)
    index_path = out_dir / "admin_index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for layer, frame in (("ccaa", ccaa), ("province", provinces)):
            path = Path(tmp) / f"{layer}.geojson"
            frame[["code", "name", "geometry"]].to_file(path, driver="GeoJSON")
            paths.append(path)
        tiles = _tile_layers(paths, out_dir / "admin_areas.pmtiles")
    return tiles, index_path


def _tile_layers(paths: list[Path], output: Path) -> Path:
    """One layer per input file (tippecanoe's `-L name:file`)."""
    import subprocess

    subprocess.run(
        [
            "tippecanoe", "-q", "-o", str(output), "--force", "-Z0", "-z10",
            "--detect-shared-borders", "--no-tile-size-limit",
            "-L", f"ccaa:{paths[0]}", "-L", f"province:{paths[1]}",
        ],
        check=True,
    )  # fmt: skip
    return output


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("municipalities_parquet")
    parser.add_argument("out_dir")
    args = parser.parse_args()
    tiles, index = write_admin_areas(args.municipalities_parquet, args.out_dir)
    counts = {level: len(rows) for level, rows in json.loads(index.read_text()).items()}
    print(f"wrote {tiles} ({tiles.stat().st_size / 1e6:.1f}MB) and {index} {counts}")


if __name__ == "__main__":
    main()
