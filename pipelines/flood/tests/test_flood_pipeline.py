import zipfile

import numpy as np
import pyarrow as pa
import shapely
from flood import exposure, sources, zones


def test_mapped_return_periods():
    assert sources.mapped_return_periods("46") == (10, 50, 100, 500)
    # Canarias has only T=100/T=500 maps.
    assert sources.mapped_return_periods("35") == (100, 500)
    assert sources.mapped_return_periods("38") == (100, 500)


def test_check_raw_flags_missing_and_captcha_pages(tmp_path):
    for source in sources.SOURCES[1:]:
        with zipfile.ZipFile(tmp_path / source.zip_name, "w") as zf:
            zf.writestr("x.shp", b"")
    # A captcha page saved under the zip's name is not a zip.
    (tmp_path / sources.SOURCES[1].zip_name).write_text("<!DOCTYPE html><html>altcha</html>")
    missing = sources.check_raw(tmp_path)
    assert [s.zip_name for s in missing] == [
        sources.SOURCES[0].zip_name,
        sources.SOURCES[1].zip_name,
    ]
    message = sources.missing_files_message(missing, tmp_path)
    assert "DescargaFichero?f=laminasPB-q10.zip" in message


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


def test_province_of_part_maps_catastro_offices():
    from pathlib import Path

    assert exposure.province_of_part(Path("46250.buildings.parquet")) == "46"
    assert exposure.province_of_part(Path("55101.buildings.parquet")) == "51"
