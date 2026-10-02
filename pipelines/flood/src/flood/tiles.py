"""Static PMTiles for the flood modes' maps (ADR-0029, ADR-0037).

Archive and layer names carry the hazard's prefix (sources.Hazard):
`flood_*` for fluvial (twinFLOOD), `coast_*` for coastal (twinCOAST).

- `flood_zones.pmtiles`, layer `flood_zones`: one feature per (census
  section, return period) from zones.py, with `rp` (10/50/100/500) and
  `sec` (the section code). The frontend filters on both: `rp` for the
  selected return period, a code prefix of `sec` for the selected area
  (municipality = first 5 digits, province = first 2).
- `flood_buildings.pmtiles`, layer `flood_buildings`: the footprints of
  buildings flooded at some return period, with `building_id`, `sec` and
  one `t<rp>` flag per return period: 1 in the zone, 0 not, absent where
  that period isn't mapped (exposure.py). Colouring buildings by filtering this static archive in
  the browser, instead of a per-scenario tile join (ADR-0017), is the
  experiment ADR-0029 describes.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import duckdb
import geopandas as gpd
import pyarrow.parquet as pq
import shapely

from .exposure import PARTS_SUFFIX
from .sources import FLUVIAL, Hazard


def zones_layer(hazard: Hazard) -> str:
    return f"{hazard.tile_prefix}_zones"


def buildings_layer(hazard: Hazard) -> str:
    return f"{hazard.tile_prefix}_buildings"


def _tippecanoe(inputs: list[Path], output: Path, layer: str, args: list[str]) -> Path:
    if shutil.which("tippecanoe") is None:
        raise RuntimeError("tippecanoe not found on PATH (brew install tippecanoe)")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["tippecanoe", "-o", str(output), "-l", layer, "--force", *args, *map(str, inputs)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        # Same as exposure.tile: without this, tippecanoe's own explanation
        # is lost with the captured output.
        print(e.stdout, file=sys.stderr)
        print(e.stderr, file=sys.stderr)
        raise
    return output


# Zone tiles come in two zoom bands, built separately and joined:
# - DETAIL (z7-13): every zone piece, nothing dropped (see below);
# - OVERVIEW (z0-6): Spain-wide, so opening a flood card shows where the
#   zones are before any run, at any zoom the map can reach (it opens at
#   z5.3 and has no minimum zoom). The same settings;
#   at these zooms tippecanoe's tiny-polygon reduction turns sub-pixel
#   pieces into pixel-sized specks rather than dropping them.
DETAIL_MINZOOM, DETAIL_MAXZOOM = 7, 13
OVERVIEW_MINZOOM = 0


def _zone_args(minzoom: int, maxzoom: int) -> list[str]:
    return [
        f"-Z{minzoom}",
        f"-z{maxzoom}",
        # tippecanoe reads FlatGeobuf integers as strings unless told
        # otherwise; the map filters on a number.
        "-T",
        "rp:int",
        # Pieces of neighbouring sections share their cut edges;
        # simplifying those edges once keeps them from drifting apart into
        # slivers.
        "--detect-shared-borders",
        # Keep the per-return-period layers stacked in the order the map
        # draws them: widest (T=500) first.
        "--order-descending-by=rp",
        # Never drop zone pieces. tippecanoe's --drop-*-as-needed and
        # --coalesce-densest-as-needed pick one threshold per zoom level: a
        # few dense floodplain tiles made it drop pieces (km2-sized ones
        # too) in every tile of that zoom, so zones came and went between
        # zooms and flagged buildings showed outside any zone. Coalescing
        # also sent polygon cleaning into an hour-long spin.
        "--no-tile-size-limit",
        "--no-feature-limit",
    ]


def tile_zones(zones_path: str | Path, output: str | Path, hazard: Hazard = FLUVIAL) -> Path:
    """Both zoom bands (above) into `output`."""
    output = Path(output)
    with tempfile.TemporaryDirectory() as tmp:
        detail = _tile_zone_band(zones_path, Path(tmp) / "detail.pmtiles", hazard, DETAIL_MINZOOM)
        return add_zone_overview(zones_path, detail, output, hazard)


def add_zone_overview(
    zones_path: str | Path, detail: str | Path, output: str | Path, hazard: Hazard = FLUVIAL
) -> Path:
    """`detail` (a z7-13 zone archive) plus a freshly built z0-6 overview,
    joined into `output`. Also how an archive built before the overview
    existed gets one, without rebuilding its detail zooms."""
    with tempfile.TemporaryDirectory() as tmp:
        overview = _tile_zone_band(
            zones_path, Path(tmp) / "overview.pmtiles", hazard, OVERVIEW_MINZOOM, DETAIL_MINZOOM - 1
        )
        return _tile_join([overview, Path(detail)], Path(output))


def _tile_zone_band(
    zones_path: str | Path,
    output: Path,
    hazard: Hazard,
    minzoom: int,
    maxzoom: int = DETAIL_MAXZOOM,
) -> Path:
    zones = gpd.read_parquet(zones_path, columns=["return_period", "section_code", "geometry"])
    zones = zones.rename(columns={"return_period": "rp", "section_code": "sec"})
    with tempfile.TemporaryDirectory() as tmp:
        fgb = Path(tmp) / "zones.fgb"
        zones.to_file(fgb, driver="FlatGeobuf")
        return _tippecanoe([fgb], output, zones_layer(hazard), _zone_args(minzoom, maxzoom))


def _tile_join(inputs: list[Path], output: Path) -> Path:
    if shutil.which("tile-join") is None:
        raise RuntimeError("tile-join not found on PATH (it ships with tippecanoe)")
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["tile-join", "-o", str(output), "--force", "--no-tile-size-limit", *map(str, inputs)],
        check=True,
        capture_output=True,
        text=True,
    )
    return output


def tile_buildings(
    building_flood_path: str | Path,
    parts_dir: str | Path,
    output: str | Path,
    hazard: Hazard = FLUVIAL,
) -> Path:
    """Footprints come from the exposure parts (the flags file keeps no
    geometry); only flooded ones are read."""
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    flag_columns = hazard.flag_columns
    flags = ", ".join(f"f.{c}" for c in flag_columns)
    table = (
        con.execute(
            f"""
        SELECT f.building_id, f.census_section_code AS sec, {flags},
               ST_AsWKB(b.geometry) AS wkb
        FROM read_parquet(?) AS f
        JOIN read_parquet(?) AS b USING (building_id)
        """,
            [str(building_flood_path), str(Path(parts_dir) / f"*{PARTS_SUFFIX}")],
        )
        .arrow()
        .read_all()
    )
    geoms = shapely.from_wkb(table.column("wkb").to_numpy(zero_copy_only=False))
    # Flags as nullable 1/0 integers: NULL (unmapped) becomes an absent
    # attribute. Nullable booleans would go through pandas as Python
    # objects and land in the tiles as the strings "True"/"False".
    props = table.drop(["wkb"]).to_pandas()
    for c in flag_columns:
        props[c] = props[c].astype("boolean").astype("Int8")
    frame = gpd.GeoDataFrame(
        props.rename(columns={c: c.removeprefix("flood_") for c in flag_columns}),
        geometry=geoms,
        crs="EPSG:4326",
    )
    with tempfile.TemporaryDirectory() as tmp:
        fgb = Path(tmp) / "buildings.fgb"
        frame.to_file(fgb, driver="FlatGeobuf")
        return _tippecanoe(
            [fgb],
            Path(output),
            buildings_layer(hazard),
            [
                # From z9: flood mode shows buildings sooner than seismic (fewer
                # of them, and they sit well with the area choropleths).
                "-Z9",
                "-z14",
                "--no-tile-size-limit",
                "--no-feature-limit",
                *[arg for c in flag_columns for arg in ("-T", f"{c.removeprefix('flood_')}:int")],
            ],
        )


def row_count(path: str | Path) -> int:
    return pq.ParquetFile(path).metadata.num_rows
