"""The road network the real-time layer draws traffic stretches along
(ADR-0026): IGN's IGR-RT "Redes de transporte", national roads-only file.

**Manual download.** CNIG refuses scripted downloads (ADR-0025). From
https://centrodedescargas.cnig.es/CentroDescargas/redes-transporte take
"España por modos. Red viaria" (GeoPackage) and unzip it into
`data/roads/raw/`, which then holds `rt_viaria.gpkg`.

Two outputs, both sorted by road so a reader can pull just the roads it
needs (parquet row-group statistics on `road`):

- `road_links.parquet`: one row per road section (`rt_tramo_vial`), with
  its road code (`nombre`: "A-7", "N-634", "BV-4023"), whether it's the
  road's main line (`Troncal`) rather than a junction, roundabout or
  service road, and its geometry (WKB, ETRS89 lon/lat).
- `road_km_posts.parquet`: kilometre posts (`rt_ppkk_p`): road, km, and
  position.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

GPKG_NAME = "rt_viaria.gpkg"
# ~1 m at Spanish latitudes: removes near-collinear vertices, keeps shape.
SIMPLIFY_DEG = 1e-5
# Names IGN uses for "no road code".
_NO_CODE = {"", "DESCONOCIDO", "NO APLICABLE"}


def _gpkg(raw_dir: str | Path) -> Path:
    path = Path(raw_dir) / GPKG_NAME
    if not path.exists():
        raise FileNotFoundError(
            f"{path} is missing: download IGN's 'España por modos. Red viaria' GeoPackage "
            "by hand (see exposure/roads.py and ADR-0026) and unzip it there"
        )
    return path


def _road_code(names: pd.Series) -> pd.Series:
    return names.fillna("").str.strip().str.upper()


def build_road_links(raw_dir: str | Path) -> gpd.GeoDataFrame:
    links = gpd.read_file(
        _gpkg(raw_dir), layer="rt_tramo_vial", columns=["nombre", "tipo_tramd"], engine="pyogrio"
    )
    links["road"] = _road_code(links["nombre"])
    links = links[~links["road"].isin(_NO_CODE) & links.geometry.notna()]
    links = gpd.GeoDataFrame(
        {
            "road": links["road"].to_numpy(),
            "main": (links["tipo_tramd"] == "Troncal").to_numpy(),
        },
        geometry=shapely.simplify(links.geometry.to_numpy(), SIMPLIFY_DEG),
        crs=links.crs,
    )
    return links.sort_values("road", kind="stable").reset_index(drop=True)


def build_km_posts(raw_dir: str | Path) -> pd.DataFrame:
    posts = gpd.read_file(
        _gpkg(raw_dir), layer="rt_ppkk_p", columns=["nombre", "numero"], engine="pyogrio"
    )
    posts["road"] = _road_code(posts["nombre"])
    posts["km"] = pd.to_numeric(posts["numero"].str.replace(",", "."), errors="coerce")
    posts = posts[~posts["road"].isin(_NO_CODE) & posts["km"].notna() & posts.geometry.notna()]
    return (
        pd.DataFrame(
            {
                "road": posts["road"].to_numpy(),
                "km": posts["km"].to_numpy(),
                "lon": posts.geometry.x.to_numpy(),
                "lat": posts.geometry.y.to_numpy(),
            }
        )
        .sort_values(["road", "km"], kind="stable")
        .reset_index(drop=True)
    )


def write_outputs(links: gpd.GeoDataFrame, posts: pd.DataFrame, out_dir: str | Path) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    table = pd.DataFrame(
        {
            "road": links["road"],
            "main": links["main"],
            "wkb": shapely.to_wkb(links.geometry.to_numpy()),
        }
    )
    # Small row groups: a reader asking for a few hundred roads skips the rest.
    table.to_parquet(
        out / "road_links.parquet", index=False, row_group_size=20_000, compression="zstd"
    )
    posts.to_parquet(
        out / "road_km_posts.parquet", index=False, row_group_size=20_000, compression="zstd"
    )
