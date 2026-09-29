"""Real-time layers (realtime.py, ADR-0026): DGT DATEX II and AEMET
observations to GeoJSON, and the in-process cache in front of both. The
DATEX II fixture is two situations cut verbatim from the live v3.7 feed."""

from __future__ import annotations

import io
import tarfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from scenario import realtime

FIXTURE = Path(__file__).parent / "fixtures" / "dgt_datex2_sample.xml"


def test_parse_dgt_point_and_linear_locations():
    fc = realtime.parse_dgt(FIXTURE.read_bytes())
    assert fc["type"] == "FeatureCollection"
    assert fc["published"].startswith("2026-09-29T")
    by_id = {f["properties"]["id"]: f for f in fc["features"]}
    assert set(by_id) == {"16676270", "23477355"}

    point = by_id["16676270"]
    assert point["geometry"]["coordinates"] == [-0.025548847, 41.705166]
    assert point["properties"]["category"] == "obstruction"
    assert point["properties"]["cause"] == "infrastructureDamageObstruction"
    assert point["properties"]["road"] == "HU-883"
    assert point["properties"]["km_from"] == "1.2"
    assert point["properties"]["km_to"] is None

    # A stretch of road is drawn at its `from` end, with both kilometre points.
    linear = by_id["23477355"]
    assert linear["geometry"]["coordinates"] == [-8.74629, 42.829906]
    props = linear["properties"]
    assert props["category"] == "accident"
    assert props["management"] == "laneClosures"
    assert (props["km_from"], props["km_to"]) == ("16.997", "17.2")
    assert (props["municipality"], props["province"]) == ("Rois", "A Coruña")
    assert props["direction"] == "southWestBound"
    assert props["start_time"].startswith("2026-05-25T")


def test_parse_aemet_keeps_each_stations_latest_hour():
    rows = [
        {
            "idema": "3195",
            "ubi": "MADRID RETIRO",
            "lat": 40.41,
            "lon": -3.68,
            "alt": 667,
            "fint": "2026-09-29T13:00:00+0000",
            "ta": 22.1,
            "hr": 40,
            "prec": 0.0,
        },
        {
            "idema": "3195",
            "ubi": "MADRID RETIRO",
            "lat": 40.41,
            "lon": -3.68,
            "alt": 667,
            "fint": "2026-09-29T14:00:00+0000",
            "ta": 23.4,
            "vv": 2.5,
        },
        {"idema": "X", "lat": None, "lon": None, "fint": "2026-09-29T14:00:00+0000", "ta": 1.0},
        # Last reported 4 h before the newest reading: stale, left off.
        {"idema": "OLD", "lat": 40.0, "lon": -3.0, "fint": "2026-09-29T10:00:00+0000", "ta": 5.0},
    ]
    fc = realtime.parse_aemet(rows)
    assert len(fc["features"]) == 1
    feature = fc["features"][0]
    assert feature["geometry"]["coordinates"] == [-3.68, 40.41]
    # The latest hour's values only: no humidity fallback to 13:00.
    assert feature["properties"] == {
        "id": "3195",
        "name": "MADRID RETIRO",
        "alt": 667,
        "time": "2026-09-29T14:00:00+0000",
        "ta": 23.4,
        "vv": 2.5,
    }
    assert fc["observed"] == "2026-09-29T14:00:00+0000"


def test_aemet_without_key_is_unavailable(monkeypatch):
    monkeypatch.delenv("TWINER_AEMET_API_KEY", raising=False)
    with pytest.raises(realtime.RealtimeUnavailable, match="TWINER_AEMET_API_KEY"):
        realtime.aemet_observations()


def test_cache_serves_within_ttl(monkeypatch):
    monkeypatch.setattr(realtime, "_cache", {})
    calls = []
    load = lambda: calls.append(1) or len(calls)
    assert realtime._cached("dgt", 60, load) == 1
    assert realtime._cached("dgt", 60, load) == 1
    assert realtime._cached("dgt", 0, load) == 2


def test_decode_falls_back_to_latin9():
    assert realtime._decode("MÁLAGA".encode("iso-8859-15"), "utf-8") == "MÁLAGA"
    assert realtime._decode("MÁLAGA".encode(), None) == "MÁLAGA"


def _cap_tarball(*names: str) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name in names:
            archive.add(FIXTURE.parent / name, arcname=name)
    return buffer.getvalue()


def test_parse_aemet_warnings_keeps_active_levels_with_both_languages():
    # Real CAP files: an orange 1 h rainfall warning (07:00-17:59 CEST) and a
    # green "no warning" file covering 16 zones.
    tarball = _cap_tarball("aemet_cap_orange.xml", "aemet_cap_green.xml")
    fc = realtime.parse_aemet_warnings(tarball, datetime(2026, 9, 29, 12, 0, tzinfo=UTC))
    assert len(fc["features"]) == 1
    feature = fc["features"][0]
    props = feature["properties"]
    assert (props["level"], props["level_rank"], props["phenomenon"]) == ("orange", 2, "PR")
    assert props["area"] == "Prepirineo de Barcelona"
    assert props["event_en"] == "Severe rain warning"
    assert props["detail_es"] == "Precipitación acumulada en una hora: 40 mm"
    assert props["expires_ms"] == int(
        datetime(2026, 9, 29, 15, 59, 59, tzinfo=UTC).timestamp() * 1000
    )
    # CAP's "lat,lon" pairs come out as GeoJSON [lon, lat], closed ring.
    ring = feature["geometry"]["coordinates"][0]
    assert ring[0] == [1.84, 42.31] and ring[0] == ring[-1]


def test_parse_aemet_warnings_drops_expired():
    tarball = _cap_tarball("aemet_cap_orange.xml")
    fc = realtime.parse_aemet_warnings(tarball, datetime(2026, 9, 29, 16, 0, tzinfo=UTC))
    assert fc["features"] == []


def test_parse_datex1_sct_and_dtgv():
    # Each fixture: one located situation, and one located only by road and
    # kilometre point, which comes out without geometry for roads.locate.
    sct = realtime.parse_datex1((FIXTURE.parent / "sct_datex1_sample.xml").read_bytes(), "SCT")
    located, unlocated = sct["features"]
    assert unlocated["geometry"] is None and "_from" not in unlocated["properties"]
    assert unlocated["properties"]["road"] and unlocated["properties"]["km_from"] is not None
    props = located["properties"]
    assert props["id"] == "GUID-1514005-1"
    assert (props["source"], props["category"], props["road"]) == ("SCT", "congestion", "B-10")
    assert (props["km_from"], props["km_to"]) == ("9.5", "4")
    assert (props["municipality"], props["province"]) == ("BARCELONA", "Barcelona")
    assert props["_from"] == tuple(located["geometry"]["coordinates"]) and props["_to"]

    dtgv = realtime.parse_datex1((FIXTURE.parent / "dtgv_datex1_sample.xml").read_bytes(), "DT-GV")
    feature = dtgv["features"][0]
    assert feature["geometry"]["coordinates"] == [-2.1528, 43.2824]
    props = feature["properties"]
    assert (props["category"], props["detail"], props["road"]) == (
        "roadworks",
        "constructionWork",
        "N-634",
    )
    assert (props["km_from"], props["km_to"], props["destination"]) == ("17", "19", "SANTANDER")
    assert dtgv["features"][1]["geometry"] is None


def test_incidents_keep_the_feeds_that_loaded(monkeypatch):
    monkeypatch.setattr(realtime, "_cache", {})

    def down() -> dict:
        raise realtime.RealtimeUnavailable("sct down")

    point = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [0, 0]},
        "properties": {},
    }
    monkeypatch.setattr(
        realtime,
        "_TRAFFIC_SOURCES",
        {
            "dgt": lambda: {"published": "t1", "features": [point]},
            "sct": down,
            "dt-gv": lambda: {"published": "t0", "features": [point, point]},
        },
    )
    fc = realtime.dgt_incidents()
    assert len(fc["features"]) == 3
    assert fc["published"] == "t1"
    assert fc["sources"] == {"dgt": "ok", "sct": "sct down", "dt-gv": "ok"}

    monkeypatch.setattr(realtime, "_cache", {})
    monkeypatch.setattr(realtime, "_TRAFFIC_SOURCES", {"dgt": down, "sct": down, "dt-gv": down})
    with pytest.raises(realtime.RealtimeUnavailable):
        realtime.dgt_incidents()
