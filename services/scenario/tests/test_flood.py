import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import shapely
from pyproj import Transformer
from scenario import flood
from scenario.flood import (
    AdminArea,
    Circle,
    FloodData,
    FloodRequestError,
    parse_region,
    select_buildings,
    summarize_flood,
    unmapped_provinces,
    validate_return_period,
)
from scenario.impact import AreaMeta, section_severity

# Two Valencia buildings (one section), one in Paiporta, one in Las Palmas
# (Canarias: no T=10/T=50 map), one in Madrid far away.
SECTIONS = ["4625001001", "4625001001", "4619001002", "3501601001", "2807901001"]
LON = np.array([-0.3763, -0.3765, -0.4172, -15.4363, -3.7038])
LAT = np.array([39.4699, 39.4701, 39.4165, 28.1235, 40.4168])
FLAGS = {
    10: np.array([True, False, False, False, True]),
    50: np.array([True, False, True, False, True]),
    100: np.array([True, True, True, True, True]),
    500: np.array([True, True, True, True, True]),
}

META = AreaMeta(
    sections={
        "4625001001": {
            "code": "4625001001",
            "municipality_name": "València",
            "population": 1000,
            "pop_under_15": 100,
            "pop_65_plus": 300,
            "n_buildings": 20,
            "n_dwellings": 400,
        },
        "4619001002": {
            "code": "4619001002",
            "municipality_name": "Paiporta",
            "population": 500,
            "n_buildings": 10,
            "n_dwellings": 0,
        },
    },
    municipalities={
        "46250": {
            "name": "València",
            "bbox_xmin": -0.43,
            "bbox_ymin": 39.28,
            "bbox_xmax": -0.27,
            "bbox_ymax": 39.57,
        },
        "46190": {
            "name": "Paiporta",
            "bbox_xmin": -0.44,
            "bbox_ymin": 39.41,
            "bbox_xmax": -0.40,
            "bbox_ymax": 39.43,
        },
    },
)


def _data(zone_bbox: np.ndarray | None = None) -> FloodData:
    zone_sections = np.array(["4625001001", "4619001002", "4625001001"], dtype=object)
    return FloodData(
        lon=LON,
        lat=LAT,
        section=np.array(SECTIONS, dtype=object),
        municipality=np.array([s[:5] for s in SECTIONS], dtype=object),
        province=np.array([s[:2] for s in SECTIONS], dtype=object),
        dwellings=np.array([100.0, 50.0, 10.0, 5.0, 1.0]),
        built_area=np.array([1000.0, 500.0, 100.0, 50.0, 10.0]),
        flags=FLAGS,
        building_id=np.array(["a", "b", "c", "d", "e"], dtype=object),
        zone_rp=np.array([100, 100, 10]),
        zone_section=zone_sections,
        zone_area_m2=np.array([2e6, 5e5, 1e6]),
        zone_bbox=zone_bbox
        if zone_bbox is not None
        else np.array(
            [
                [-0.38, 39.46, -0.37, 39.48],
                [-0.42, 39.41, -0.41, 39.42],
                [-0.38, 39.46, -0.37, 39.48],
            ]
        ),
        infrastructure=pa.table(
            {
                "asset_id": [1, 2],
                "category": ["health", "education"],
                "subtype": ["hospital", "school"],
                "name": ["Hospital", "Escuela"],
                "lon": [-0.3763, -3.7],
                "lat": [39.47, 40.4],
                "municipality_code": ["46250", "28079"],
                "flood_t10": pa.array([False, True]),
                "flood_t50": pa.array([True, True]),
                "flood_t100": pa.array([True, True]),
                "flood_t500": pa.array([True, True]),
            }
        ),
    )


def test_parse_region_circle_and_admin():
    assert parse_region({"type": "circle", "lat": 39.47, "lon": -0.37, "radius_km": 10}) == Circle(
        39.47, -0.37, 10
    )
    assert parse_region({"type": "admin", "level": "ccaa", "code": "10"}) == AdminArea("ccaa", "10")
    assert parse_region({"type": "admin", "level": "municipality", "code": "46250"}) == AdminArea(
        "municipality", "46250"
    )


@pytest.mark.parametrize(
    "body",
    [
        {"type": "circle", "lat": 39.47, "lon": -0.37, "radius_km": 0},
        {"type": "circle", "lat": 39.47, "lon": -0.37, "radius_km": 500},
        {"type": "circle", "lat": 39.47},
        {"type": "admin", "level": "ccaa", "code": "20"},
        {"type": "admin", "level": "province", "code": "53"},
        {"type": "admin", "level": "municipality", "code": "4625"},
        {"type": "admin", "level": "barrio", "code": "46"},
        {"type": "polygon"},
    ],
)
def test_parse_region_rejects(body):
    with pytest.raises(FloodRequestError):
        parse_region(body)


def test_validate_return_period():
    assert validate_return_period("100") == 100
    with pytest.raises(FloodRequestError):
        validate_return_period(25)


def test_select_buildings_circle_uses_exact_distance():
    data = _data()
    # ~5km around Valencia's centre: both Valencia buildings, not Paiporta
    # (~6.7km away) although it's inside the circle's bounding box.
    rows = select_buildings(data, Circle(39.4699, -0.3763, 5.0), 100)
    assert list(data.building_id[rows]) == ["a", "b"]
    # T=10: only "a" is flooded.
    assert list(data.building_id[select_buildings(data, Circle(39.4699, -0.3763, 5.0), 10)]) == [
        "a"
    ]


def test_select_buildings_admin_levels():
    data = _data()
    ids = lambda region, rp=100: list(data.building_id[select_buildings(data, region, rp)])
    assert ids(AdminArea("province", "46")) == ["a", "b", "c"]
    assert ids(AdminArea("municipality", "46190")) == ["c"]
    assert ids(AdminArea("ccaa", "05")) == ["d"]
    assert ids(AdminArea("ccaa", "13")) == ["e"]


def test_unmapped_provinces():
    assert unmapped_provinces(AdminArea("ccaa", "05"), 10) == ["35", "38"]
    assert unmapped_provinces(AdminArea("ccaa", "05"), 100) == []
    assert unmapped_provinces(AdminArea("province", "46"), 10) == []
    assert unmapped_provinces(Circle(28.1, -15.4, 20), 50) == ["35", "38"]
    assert unmapped_provinces(Circle(39.47, -0.37, 20), 50) == []


def test_summarize_flood_province():
    summary = summarize_flood(AdminArea("province", "46"), 100, data=_data(), meta=META)
    assert summary.n_flooded == 3
    by_muni = {r["municipality_code"]: r for r in summary.municipality_stats}
    valencia = by_muni["46250"]
    assert valencia["n_flooded"] == 2
    assert valencia["n_buildings"] == 0  # no municipality totals in META: sums of sections only
    assert valencia["flooded_dwellings"] == 150
    # 150 of 400 dwellings -> 375 of 1000 residents; vulnerable 40%.
    assert valencia["affected_population"] == 375
    assert valencia["affected_vulnerable_population"] == 150
    assert valencia["flooded_area_km2"] == 2.0
    # Paiporta has no dwellings recorded: spread by building (1 of 10).
    assert by_muni["46190"]["affected_population"] == 50
    section = next(s for s in summary.section_stats if s["section_code"] == "4625001001")
    assert section["pct_buildings_flooded"] == 10.0
    assert section["name"] == "València 01-001"
    assert summary.totals["n_municipalities"] == 2
    # Infrastructure: the hospital (T=100 flagged, in 46250), not the
    # Madrid school.
    assert summary.infrastructure is not None
    assert [r["asset_id"] for r in summary.infrastructure] == [1]


def test_summarize_flood_circle_areas_inside_and_clipped(tmp_path, monkeypatch):
    # Zone pieces: Valencia's fully inside a 5km circle, Paiporta's crossing
    # its edge -- clipped against zones.parquet.
    paiporta_piece = shapely.box(-0.43, 39.41, -0.40, 39.43)
    table = pa.table(
        {
            "return_period": pa.array([100], pa.int16()),
            "section_code": ["4619001002"],
            "bbox_xmin": [-0.43],
            "bbox_ymin": [39.41],
            "bbox_xmax": [-0.40],
            "bbox_ymax": [39.43],
            "geometry": [shapely.to_wkb(paiporta_piece)],
        }
    )
    pq.write_table(table, tmp_path / "zones.parquet")
    monkeypatch.setattr(flood, "FLOOD_DIR", str(tmp_path))
    data = _data(
        zone_bbox=np.array(
            [
                [-0.378, 39.468, -0.375, 39.471],
                [-0.43, 39.41, -0.40, 39.43],
                [-0.38, 39.46, -0.37, 39.48],
            ]
        )
    )
    circle = Circle(39.4699, -0.3763, 7.0)
    areas = flood.flooded_area_by_section(data, circle, 100)
    assert areas["4625001001"] == 2e6
    to_laea = Transformer.from_crs(4326, 3035, always_xy=True)
    full = shapely.area(
        shapely.transform(
            paiporta_piece, lambda xy: np.column_stack(to_laea.transform(xy[:, 0], xy[:, 1]))
        )
    )
    # Partly inside: some of it, not all of it.
    assert 0.05 * full < areas["4619001002"] < 0.95 * full


def test_section_severity_handles_both_hazards():
    stats = [
        {
            "section_code": "1",
            "counts": {"None": 1, "Slight": 1, "Moderate": 0, "Extensive": 0, "Complete": 0},
        },
        {"section_code": "2", "n_flooded": 3, "pct_buildings_flooded": 12.5},
        {"section_code": "3", "n_flooded": 0, "pct_buildings_flooded": None},
    ]
    assert section_severity(stats) == {"1": 0.5, "2": 12.5, "3": 0.0}
