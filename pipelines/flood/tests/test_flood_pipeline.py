import zipfile

import numpy as np
import pyarrow as pa
import shapely
from flood import areas, exposure, sources, tiles, zones


def test_mapped_return_periods():
    fluvial = sources.FLUVIAL
    assert fluvial.mapped_return_periods("46") == (10, 50, 100, 500)
    # Canarias has only T=100/T=500 fluvial maps.
    assert fluvial.mapped_return_periods("35") == (100, 500)
    assert fluvial.mapped_return_periods("38") == (100, 500)
    # Ceuta/Melilla are in the Península + Baleares files.
    assert fluvial.mapped_return_periods("51") == (10, 50, 100, 500)


def test_coastal_maps_cover_everywhere_at_two_periods():
    coastal = sources.COASTAL
    assert coastal.return_periods == (100, 500)
    assert coastal.flag_columns == ("flood_t100", "flood_t500")
    for province in ("46", "35", "38", "51", "52", "28"):
        assert coastal.mapped_return_periods(province) == (100, 500)


def test_geographic_sources_are_cleaned_in_metres():
    (q100, _) = sources.COASTAL.sources
    assert q100.epsg == 4258 and q100.work_epsg == sources.METRIC_EPSG
    assert all(s.work_epsg == s.epsg for s in sources.FLUVIAL.sources)


def test_check_raw_flags_missing_and_captcha_pages(tmp_path):
    fluvial = sources.FLUVIAL.sources
    for source in fluvial[1:]:
        with zipfile.ZipFile(tmp_path / source.zip_name, "w") as zf:
            zf.writestr("x.shp", b"")
    # A captcha page saved under the zip's name is not a zip.
    (tmp_path / fluvial[1].zip_name).write_text("<!DOCTYPE html><html>altcha</html>")
    missing = sources.check_raw(tmp_path)
    assert [s.zip_name for s in missing] == [fluvial[0].zip_name, fluvial[1].zip_name]
    message = sources.missing_files_message(missing, tmp_path)
    assert "DescargaFichero?f=laminasPB-q10.zip" in message


def test_check_raw_per_hazard(tmp_path):
    # The fluvial T=50 zip shares the coastal files' naming pattern, but a
    # fluvial raw dir never satisfies the coastal check (and vice versa).
    with zipfile.ZipFile(tmp_path / "laminas-q50.zip", "w") as zf:
        zf.writestr("x.shp", b"")
    missing = sources.check_raw(tmp_path, sources.COASTAL)
    assert [s.zip_name for s in missing] == ["laminas-q100.zip", "laminas-q500.zip"]
    message = sources.missing_files_message(missing, tmp_path, sources.COASTAL)
    assert "coastal" in message and "zi-origen-marino" in message


def test_polygonal_keeps_only_areas():
    square = shapely.box(0, 0, 1, 1)
    mixed = shapely.GeometryCollection([square, shapely.LineString([(2, 2), (3, 3)])])
    out = zones.polygonal(
        np.array(
            [square, mixed, shapely.LineString([(0, 0), (1, 1)]), shapely.Polygon()], dtype=object
        )
    )
    assert out[0].equals(square)
    assert out[1].equals(square)
    assert out[2] is None and out[3] is None


def test_cut_by_sections_inside_and_across():
    sections = np.array([shapely.box(0, 0, 1, 1), shapely.box(1, 0, 2, 1)], dtype=object)
    tree = shapely.STRtree(sections)
    inside = shapely.box(0.2, 0.2, 0.4, 0.4)
    across = shapely.box(0.5, 0.2, 1.5, 0.4)
    gi, si, pieces = zones.cut_by_sections(np.array([inside, across], dtype=object), sections, tree)
    got = sorted(zip(gi.tolist(), si.tolist(), [round(p.area, 6) for p in pieces]))
    assert got == [(0, 0, 0.04), (1, 0, 0.1), (1, 1, 0.1)]


def test_intersects_any_uses_the_footprint_not_the_centroid():
    zone = shapely.box(0, 0, 1, 1)
    tree = shapely.STRtree(np.array([zone], dtype=object))
    # Centroid (1.5, 0.5) is dry; the west wall is in the zone.
    straddling = shapely.box(0.9, 0.4, 2.1, 0.6)
    dry = shapely.box(3, 3, 4, 4)
    hit = exposure.intersects_any(np.array([straddling, dry], dtype=object), tree)
    assert hit.tolist() == [True, False]


def test_flags_table_nulls_unmapped_return_periods():
    ids = pa.array(["a", "b", "c"])
    hits = {
        10: np.array([True, False, False]),
        50: np.array([False, False, False]),
        100: np.array([True, True, False]),
        500: np.array([True, True, False]),
    }
    peninsula = exposure.flags_table(ids, hits, "46")
    assert peninsula.column("building_id").to_pylist() == ["a", "b"]
    assert peninsula.column("flood_t10").to_pylist() == [True, False]
    # Canarias: T=10/T=50 unmapped -> NULL, and a T=10 "hit" there can't
    # make a building count (there's no T=10 zone to hit in practice).
    canarias = exposure.flags_table(ids, hits, "35")
    assert canarias.column("building_id").to_pylist() == ["a", "b"]
    assert canarias.column("flood_t10").to_pylist() == [None, None]
    assert canarias.column("flood_t100").to_pylist() == [True, True]


def test_flags_table_coastal_has_two_columns_never_null():
    ids = pa.array(["a", "b"])
    hits = {100: np.array([False, False]), 500: np.array([True, False])}
    table = exposure.flags_table(ids, hits, "35", hazard=sources.COASTAL)
    assert table.column_names == ["building_id", "part_code", "flood_t100", "flood_t500"]
    assert table.column("flood_t100").to_pylist() == [False]
    assert table.column("flood_t500").to_pylist() == [True]


def test_covered_areas_drop_slivers_but_keep_flagged_buildings(tmp_path):
    import json

    import pyarrow.parquet as pq

    zone_areas = tmp_path / "zone_areas.parquet"
    pq.write_table(
        pa.table(
            {
                "municipality_code": ["46250", "46250", "46244", "03014"],
                "area_m2": [5e5, 8e5, 2.0, 50.0],
            }
        ),
        zone_areas,
    )
    building_flood = tmp_path / "building_flood.parquet"
    # 03014's zone is a sliver, but one of its buildings is flagged.
    pq.write_table(
        pa.table({"census_section_code": ["4625001001", "0301402003", None]}), building_flood
    )
    out = tmp_path / "coast_areas.json"
    index = areas.write_areas(zone_areas, building_flood, out)
    assert index == {"municipality": ["03014", "46250"], "province": ["03", "46"]}
    assert json.loads(out.read_text()) == index


def test_province_of_part_maps_catastro_offices():
    from pathlib import Path

    assert exposure.province_of_part(Path("46250.buildings.parquet")) == "46"
    assert exposure.province_of_part(Path("55101.buildings.parquet")) == "51"


def test_zone_bands_never_drop_features():
    overview = tiles._zone_args(tiles.OVERVIEW_MINZOOM, tiles.DETAIL_MINZOOM - 1)
    detail = tiles._zone_args(tiles.DETAIL_MINZOOM, tiles.DETAIL_MAXZOOM)
    assert overview[:2] == ["-Z0", "-z6"] and detail[:2] == ["-Z7", "-z13"]
    for args in (overview, detail):
        assert "--no-feature-limit" in args and "--no-tile-size-limit" in args
        assert not any(a.startswith(("--drop", "--coalesce")) for a in args)
    assert tiles.zones_layer(sources.COASTAL) == "coast_zones"
    assert tiles.buildings_layer(sources.FLUVIAL) == "flood_buildings"
