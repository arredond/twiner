"""roads.py (ADR-0026): drawing traffic stretches along a road, on a small
synthetic network in the shape of IGN's (sections as separate lines,
dual carriageways as two one-way lines, km posts in pairs)."""

from __future__ import annotations

import numpy as np
import shapely
from scenario import roads

# ~1 km of longitude at 40°N.
KM = 1000 / (roads._M_PER_DEG * np.cos(np.radians(40)))
LAT = 40.0


def _wkb(geometry: shapely.Geometry) -> bytes:
    wkb = shapely.to_wkb(geometry)
    assert isinstance(wkb, bytes)
    return wkb


def _line(*xs: float, lat: float = LAT) -> bytes:
    return _wkb(shapely.LineString([(x * KM, lat) for x in xs]))


def _road(lines: list[bytes], main: list[bool] | None = None, posts=()) -> roads.Road:
    return roads.Road.build(lines, main or [True] * len(lines), list(posts))


def _length_km(coords: list) -> float:
    return roads._line_metres(np.array(coords)) / 1000


def test_path_follows_sections_between_two_points():
    road = _road([_line(0, 1), _line(1, 2), _line(2, 3)])
    coords = road.path((0.5 * KM, LAT), (2.5 * KM, LAT), expected_m=2000)
    assert coords is not None
    assert abs(_length_km(coords) - 2.0) < 0.01
    assert coords[0][0] < coords[-1][0]  # from start to end


def test_path_bridges_small_gaps():
    # Two pieces 10 m apart: bridged.
    road = _road([_line(0, 1), _line(1.01, 2)])
    coords = road.path((0.5 * KM, LAT), (1.5 * KM, LAT), expected_m=1000)
    assert coords is not None and abs(_length_km(coords) - 1.0) < 0.02


def test_path_rejects_detours():
    # A dead end at x=1 km and another section starting at x=1.3 km on the
    # same line, joined only by a loop 2 km south and out to x=5 km: fine
    # to route, wrong to draw for a 450 m stretch.
    south = LAT - 0.02

    def seg(*points: tuple[float, float]) -> bytes:
        return _wkb(shapely.LineString([(x * KM, y) for x, y in points]))

    road = _road(
        [
            seg((0, LAT), (1, LAT)),
            seg((1, LAT), (1, south)),
            seg((1, south), (5, south)),
            seg((5, south), (5, LAT)),
            seg((5, LAT), (1.3, LAT)),
        ]
    )
    start, end = (0.9 * KM, LAT), (1.35 * KM, LAT)
    assert road.path(start, end, expected_m=450) is None
    assert road.path(start, end, expected_m=1e9) is not None  # routable, just too long


def test_dual_carriageway_stays_on_one_side():
    # Two carriageways 30 m apart, joined only at their ends; the feed's
    # points sit between them. The path must not go round via a junction.
    offset = 30 / roads._M_PER_DEG
    north = [_line(0, 1, lat=LAT + offset), _line(1, 2, lat=LAT + offset)]
    south = [_line(2, 1, lat=LAT - offset), _line(1, 0, lat=LAT - offset)]
    joins = [
        _wkb(shapely.LineString([(0, LAT - offset), (0, LAT + offset)])),
        _wkb(shapely.LineString([(2 * KM, LAT - offset), (2 * KM, LAT + offset)])),
    ]
    road = _road(north + south + joins, main=[True] * 4 + [False] * 2)
    coords = road.path((0.4 * KM, LAT), (1.6 * KM, LAT), expected_m=1200)
    assert coords is not None
    assert _length_km(coords) < 1.3


def test_far_points_and_unknown_roads_stay_points():
    road = _road([_line(0, 1)])
    assert road.path((0.5 * KM, LAT + 0.1), (0.9 * KM, LAT), expected_m=400) is None


def test_km_point_interpolates_between_posts():
    posts = [(10.0, 0.0, LAT), (10.0, 0.0, LAT + 0.0003), (11.0, KM, LAT)]
    road = _road([_line(0, 1)], posts=posts)
    point = road.km_point(10.25)
    assert point is not None
    lon, lat = point
    assert abs(lon - 0.25 * KM) < 1e-9 and abs(lat - LAT) < 1e-9
    assert road.km_point(3.0) is None


def test_locate_draws_lines_places_km_only_records_and_drops_the_rest(monkeypatch):
    road = _road(
        [_line(0, 1), _line(1, 2)], posts=[(0.0, 0.0, LAT), (1.0, KM, LAT), (2.0, 2 * KM, LAT)]
    )
    monkeypatch.setattr(roads, "_roads", {"N-1": road, "X-9": None})
    monkeypatch.setattr(roads, "_lines", {})
    features = [
        # A stretch with both end points.
        {
            "geometry": {"type": "Point", "coordinates": [0.2 * KM, LAT]},
            "properties": {
                "road": "N-1",
                "km_from": "0.2",
                "km_to": "1.8",
                "_from": (0.2 * KM, LAT),
                "_to": (1.8 * KM, LAT),
            },
        },
        # Road and km only: placed from the posts, and drawn.
        {"geometry": None, "properties": {"road": "N-1", "km_from": "0.5", "km_to": "1.5"}},
        # Unknown road and no coordinates: dropped.
        {"geometry": None, "properties": {"road": "X-9", "km_from": "1", "km_to": "2"}},
    ]
    out = roads.locate(features)
    kinds = [f["geometry"]["type"] for f in out]
    assert kinds == ["Point", "LineString", "Point", "LineString"]
    assert out[2]["geometry"]["coordinates"] == [round(0.5 * KM, 6), LAT]
    assert all("_from" not in f["properties"] and "_to" not in f["properties"] for f in out)
