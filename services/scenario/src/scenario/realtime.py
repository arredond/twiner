"""Real-time map layers (ADR-0026): traffic incidents (DGT, plus Catalonia's
SCT and the Basque Country's DT-GV), AEMET station
observations and AEMET weather warnings, fetched from their official
open-data APIs and handed to the frontend as GeoJSON.

Both go through the backend rather than the browser calling them directly:
- the NAP's DATEX II feeds send no CORS headers;
- AEMET OpenData needs an API key (free, by email), which mustn't ship in
  the frontend bundle. Set `TWINER_AEMET_API_KEY`.

Each result is cached in-process for a little under its source's own update
cadence, so a burst of viewers (or one viewer's auto-refresh) doesn't turn
into a burst of upstream requests. Stdlib only (urllib, ElementTree): this
module is imported by the scenario Lambda, whose cold path we keep lean.
"""

from __future__ import annotations

import gzip
import io
import json
import os
import tarfile
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

from . import roads

# DATEX II v3.7, the DGT's National Access Point. The older v3.6 URL now
# 301s here; the v1 infocar.dgt.es feed is gone (404).
DGT_URL = "https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml"
# Catalonia and the Basque Country run their own traffic services, which
# the DGT feed excludes; the same NAP republishes theirs, as DATEX II v1.
SCT_URL = "https://nap.dgt.es/datex2/sct/SituationPublication/all/content.xml"
DTGV_URL = "https://nap.dgt.es/datex2/dt-gv/SituationPublication/all/content.xml"
# Last 24 h of hourly conventional observations, every station.
AEMET_URL = "https://opendata.aemet.es/opendata/api/observacion/convencional/todas"
# Meteoalerta: the latest CAP warnings issued for all of Spain, as a tarball
# of one CAP 1.2 XML file per alert.
AEMET_WARNINGS_URL = "https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/esp"

DGT_TTL_S = 60
AEMET_TTL_S = 600
TIMEOUT_S = 20


class RealtimeUnavailable(Exception):
    """The upstream source can't be reached or isn't configured (a 503)."""


# --- Caching -------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}
_locks: dict[str, threading.Lock] = {
    "dgt": threading.Lock(),
    "sct": threading.Lock(),
    "dt-gv": threading.Lock(),
    "aemet": threading.Lock(),
    "aemet_warnings": threading.Lock(),
}


def _cached(key: str, ttl_s: float, load: Callable[[], Any]) -> Any:
    # One loader at a time per source: concurrent requests on an expired
    # entry wait for the first one's fetch instead of all hitting upstream.
    with _locks[key]:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl_s:
            return hit[1]
        value = load()
        _cache[key] = (time.monotonic(), value)
        return value


def _get(url: str, headers: dict[str, str] | None = None) -> tuple[bytes, str | None]:
    request = urllib.request.Request(
        url, headers={"User-Agent": "twiner", "Accept-Encoding": "gzip", **(headers or {})}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return body, response.headers.get_content_charset()
    except OSError as e:  # URLError, HTTPError and timeouts are all OSErrors
        raise RealtimeUnavailable(f"{url}: {e}") from e


# --- DGT incidents -----------------------------------------------------------

_NS = {
    "com": "http://levelC/schema/3/common",
    "loc": "http://levelC/schema/3/locationReferencing",
    "lse": "http://levelC/schema/3/locationReferencingSpanishExtension",
    "sit": "http://levelC/schema/3/situation",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}
_XSI_TYPE = f"{{{_NS['xsi']}}}type"

# DATEX II causeType -> the handful of categories the map colours by. The
# exact cause (and its detail) still goes in each feature's properties.
_CATEGORIES = {
    "accident": "accident",
    "vehicleObstruction": "obstruction",
    "obstruction": "obstruction",
    "infrastructureDamageObstruction": "obstruction",
    "environmentalObstruction": "weather",
    "poorEnvironment": "weather",
    "abnormalTraffic": "congestion",
    "roadMaintenance": "roadworks",
}


_TRAFFIC_SOURCES: dict[str, Callable[[], dict]] = {
    "dgt": lambda: parse_dgt(_get(DGT_URL)[0]),
    "sct": lambda: parse_datex1(_get(SCT_URL)[0], "SCT"),
    "dt-gv": lambda: parse_datex1(_get(DTGV_URL)[0], "DT-GV"),
}


def dgt_incidents() -> dict:
    """All three feeds as one collection. Each is fetched and cached on its
    own, so one being down leaves the others on the map: `sources` says
    which loaded. Only when none did is the layer unavailable."""

    def load(key: str) -> dict | str:
        try:
            return _cached(key, DGT_TTL_S, _TRAFFIC_SOURCES[key])
        except (RealtimeUnavailable, ET.ParseError) as e:
            return str(e)

    with ThreadPoolExecutor(len(_TRAFFIC_SOURCES)) as pool:
        results = dict(zip(_TRAFFIC_SOURCES, pool.map(load, _TRAFFIC_SOURCES), strict=True))
    loaded = {k: v for k, v in results.items() if isinstance(v, dict)}
    if not loaded:
        raise RealtimeUnavailable("; ".join(str(v) for v in results.values()))
    # Copies: roads.locate edits properties, and the per-feed results are
    # cached and shared between calls.
    features = [
        {**f, "properties": dict(f["properties"])} for v in loaded.values() for f in v["features"]
    ]
    return {
        "type": "FeatureCollection",
        # The DGT's publication time when it loaded, else the newest.
        "published": (loaded.get("dgt") or {}).get("published")
        or max((v.get("published") or "" for v in loaded.values()), default=None),
        "sources": {k: ("ok" if k in loaded else results[k]) for k in results},
        # Stretches as lines along the road: shelved for now (roads.py).
        "features": roads.locate(features) if roads.enabled() else roads.points_only(features),
    }


def _text(element: ET.Element | None, path: str) -> str | None:
    if element is None:
        return None
    found = element.find(path, _NS)
    return found.text.strip() if found is not None and found.text else None


def _point(element: ET.Element | None) -> dict | None:
    """A TPEG point's coordinates plus DGT's Spanish extension."""
    if element is None:
        return None
    lat = _text(element, "loc:pointCoordinates/loc:latitude")
    lon = _text(element, "loc:pointCoordinates/loc:longitude")
    if lat is None or lon is None:
        return None
    ext = ".//lse:"
    return {
        "lat": float(lat),
        "lon": float(lon),
        "km": _text(element, ext + "kilometerPoint"),
        "municipality": _text(element, ext + "municipality"),
        "province": _text(element, ext + "province"),
    }


def parse_dgt(xml: bytes) -> dict:
    """One Point feature per situation record: the DGT's own records, not
    grouped, since one situation (a crash) often has several (the crash,
    the lane closure it causes). A linear record (a stretch of road) is
    drawn at its start point: its only other geometry is its end point,
    and a straight line between the two isn't the road."""
    root = ET.fromstring(xml)
    features = []
    for situation in root.iterfind("sit:situation", _NS):
        for record in situation.iterfind("sit:situationRecord", _NS):
            location = record.find("sit:locationReference", _NS)
            linear = location.find("loc:tpegLinearLocation", _NS) if location is not None else None
            if linear is not None:
                start = _point(linear.find("loc:from", _NS))
                end = _point(linear.find("loc:to", _NS))
                direction = _text(linear, "loc:tpegDirection")
            else:
                start = (
                    _point(location.find("loc:tpegPointLocation/loc:point", _NS))
                    if location is not None
                    else None
                )
                end = None
                direction = _text(location, "loc:tpegPointLocation/loc:tpegDirection")
            if start is None:
                continue

            cause = _text(record, "sit:cause/sit:causeType")
            detail_element = record.find("sit:cause/sit:detailedCauseType", _NS)
            detail = next(
                (
                    child.text.strip()
                    for child in (detail_element if detail_element is not None else [])
                    if child.text
                ),
                None,
            )
            record_type = (record.get(_XSI_TYPE) or "").split(":")[-1]
            properties = {
                "id": record.get("id"),
                "source": "DGT",
                "situation_id": situation.get("id"),
                "category": _CATEGORIES.get(cause or "", "other"),
                "cause": cause,
                "detail": detail,
                "record_type": record_type,
                # Closures and restrictions: what the record does to the road.
                "management": _text(record, "sit:roadOrCarriagewayOrLaneManagementType")
                or _text(record, "sit:generalInstructionToRoadUsersType"),
                "speed_limit": _text(record, "sit:temporarySpeedLimit"),
                "severity": _text(record, "sit:severity")
                or _text(situation, "sit:overallSeverity"),
                "road": _text(location, ".//loc:roadName"),
                "destination": _text(location, ".//loc:roadDestination"),
                "direction": direction,
                "km_from": start["km"],
                "km_to": end["km"] if end else None,
                "municipality": start["municipality"],
                "province": start["province"],
                "start_time": _text(
                    record, "sit:validity/com:validityTimeSpecification/com:overallStartTime"
                ),
                "end_time": _text(
                    record, "sit:validity/com:validityTimeSpecification/com:overallEndTime"
                ),
            }
            # Both end points, for roads.locate to draw the stretch between.
            properties["_from"] = (start["lon"], start["lat"])
            if end:
                properties["_to"] = (end["lon"], end["lat"])
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [start["lon"], start["lat"]]},
                    "properties": properties,
                }
            )
    return {
        "type": "FeatureCollection",
        "published": _text(root, "com:publicationTime"),
        "features": features,
    }


# --- SCT / DT-GV incidents (DATEX II v1) ---------------------------------------

_D1 = {"d": "http://datex2.eu/schema/1_0/1_0"}

# v1 has no causeType: the record's own type says what it is.
_V1_CATEGORIES = {
    "Accident": "accident",
    "VehicleObstruction": "obstruction",
    "GeneralObstruction": "obstruction",
    "AnimalPresenceObstruction": "obstruction",
    "InfrastructureDamageObstruction": "obstruction",
    "EnvironmentalObstruction": "weather",
    "PoorEnvironmentConditions": "weather",
    "WeatherRelatedRoadConditions": "weather",
    "NonWeatherRelatedRoadConditions": "weather",
    "AbnormalTraffic": "congestion",
    "MaintenanceWorks": "roadworks",
    "ConstructionWorks": "roadworks",
}
# The element giving a record type's detail, e.g. MaintenanceWorks ->
# roadMaintenanceType. Tried in order; the first present wins.
_V1_DETAILS = (
    "accidentType",
    "vehicleObstructionType",
    "obstructionType",
    "animalPresenceType",
    "environmentalObstructionType",
    "poorEnvironmentType",
    "abnormalTrafficType",
    "roadMaintenanceType",
    "constructionWorkType",
    "publicEventType",
    "networkManagementType",
)


def _d1(element: ET.Element | None, path: str) -> str | None:
    if element is None:
        return None
    found = element.find(path, _D1)
    return found.text.strip() if found is not None and found.text and found.text.strip() else None


def _d1_point(element: ET.Element | None) -> dict | None:
    """A v1 TPEG point: coordinates, and the town among its names."""
    if element is None:
        return None
    lat = _d1(element, "d:pointCoordinates/d:latitude")
    lon = _d1(element, "d:pointCoordinates/d:longitude")
    if lat is None or lon is None:
        return None
    names = {
        _d1(name, "d:tpegDescriptorType"): _d1(name, "d:descriptor/d:value")
        for name in element.iterfind("d:name", _D1)
    }
    return {
        "lat": float(lat),
        "lon": float(lon),
        "town": names.get("townName"),
        "link": names.get("linkName"),
    }


def _d1_km(reference_point: ET.Element | None) -> str | None:
    # referencePointDistance is in metres from the road's origin.
    metres = _d1(reference_point, "d:referencePointDistance")
    try:
        return f"{float(metres) / 1000:g}" if metres is not None else None
    except ValueError:
        return None


def parse_datex1(xml: bytes, source: str) -> dict:
    """Catalonia's (SCT) and the Basque Country's (DT-GV) DATEX II v1 feeds,
    as the same features parse_dgt makes. Records located only by road and
    kilometre point, with no coordinates (~a quarter of both feeds), come
    out with no geometry, for roads.locate to place from kilometre posts."""
    root = ET.fromstring(xml)
    features = []
    for situation in root.iter(f"{{{_D1['d']}}}situation"):
        for record in situation.iterfind("d:situationRecord", _D1):
            location = record.find("d:groupOfLocations/d:locationContainedInGroup", _D1)
            if location is None:
                continue
            linear = location.find("d:tpeglinearLocation", _D1)
            if linear is not None:
                start = _d1_point(linear.find("d:from", _D1))
                end = _d1_point(linear.find("d:to", _D1))
                direction = _d1(linear, "d:tpegDirection")
            else:
                start = _d1_point(location.find("d:tpegpointLocation/d:point", _D1))
                end = None
                direction = _d1(location, "d:tpegpointLocation/d:tpegDirection")
            primary = location.find(".//d:referencePointPrimaryLocation/d:referencePoint", _D1)
            if primary is None:
                primary = location.find(".//d:referencePoint", _D1)
            secondary = location.find(".//d:referencePointSecondaryLocation/d:referencePoint", _D1)
            record_type = (record.get(_XSI_TYPE) or "").split(":")[-1]
            detail = next(
                (v for tag in _V1_DETAILS if (v := _d1(record, f"d:{tag}"))), None
            ) or _d1(record, "d:cause/d:causeType")
            layout = _d1(record, "d:effectOnRoadLayout")
            impact = _d1(record, "d:impact/d:impactOnTraffic")
            management = (
                _d1(record, "d:networkManagementType")
                or _d1(record, "d:trafficRestrictionType")
                or (layout if layout != "roadLayoutUnchanged" else None)
                or ("roadClosed" if impact == "impossible" else None)
            )
            start = start or {"town": None, "link": None}
            properties = {
                "id": record.get("id"),
                "source": source,
                "situation_id": situation.get("id"),
                "category": _V1_CATEGORIES.get(record_type, "other"),
                "cause": record_type,
                "detail": detail,
                "record_type": record_type,
                "management": management,
                "speed_limit": None,
                "severity": None,
                "road": _d1(primary, "d:roadNumber") or start["link"],
                "destination": _d1(location, ".//d:alertCDirectionNamed/d:value")
                or _d1(primary, ".//d:directionNamed"),
                "direction": direction,
                "km_from": _d1_km(primary),
                "km_to": _d1_km(secondary),
                "municipality": start["town"],
                "province": _d1(primary, "d:administrativeArea/d:value"),
                "start_time": _d1(
                    record, "d:validity/d:validityTimeSpecification/d:overallStartTime"
                ),
                "end_time": _d1(record, "d:validity/d:validityTimeSpecification/d:overallEndTime"),
            }
            # No coordinates (only road + km): geometry None, for
            # roads.locate to place from kilometre posts, or drop.
            point = None
            if "lon" in start:
                properties["_from"] = (start["lon"], start["lat"])
                point = {"type": "Point", "coordinates": [start["lon"], start["lat"]]}
            if end:
                properties["_to"] = (end["lon"], end["lat"])
            features.append({"type": "Feature", "geometry": point, "properties": properties})
    return {
        "type": "FeatureCollection",
        "published": _d1(root, ".//d:publicationTime"),
        "features": features,
    }


# --- AEMET observations ------------------------------------------------------

# What each station feature carries: AEMET's own field names, all optional
# (a station reports only what it has sensors for). Units as AEMET's:
# °C, %, mm, m/s, degrees, hPa, km, cm.
# A station whose latest reading is this much older than the newest one
# overall has stopped reporting: left off rather than shown as current.
AEMET_STALE_AFTER = timedelta(hours=3)

AEMET_FIELDS = ("ta", "tamax", "tamin", "hr", "prec", "vv", "vmax", "dv", "pres", "vis", "nieve")


def _aemet_key() -> str:
    api_key = os.environ.get("TWINER_AEMET_API_KEY")
    if not api_key:
        raise RealtimeUnavailable("AEMET OpenData isn't configured (TWINER_AEMET_API_KEY unset)")
    return api_key


def aemet_observations() -> dict:
    api_key = _aemet_key()
    return _cached("aemet", AEMET_TTL_S, lambda: parse_aemet(_fetch_aemet(api_key)))


def _decode(body: bytes, charset: str | None) -> str:
    # AEMET serves its data files as ISO-8859-15 while labelling some of them
    # UTF-8 (or not at all): trust a clean UTF-8 decode, fall back otherwise.
    try:
        return body.decode(charset or "utf-8")
    except (UnicodeDecodeError, LookupError):
        return body.decode("iso-8859-15")


def _aemet_datos(url: str, api_key: str) -> tuple[bytes, str | None]:
    # Two steps: the API answers with a short-lived URL to the data itself.
    body, charset = _get(url, {"api_key": api_key})
    envelope = json.loads(_decode(body, charset))
    if envelope.get("estado") != 200 or "datos" not in envelope:
        raise RealtimeUnavailable(f"AEMET: {envelope.get('estado')} {envelope.get('descripcion')}")
    return _get(envelope["datos"])


def _fetch_aemet(api_key: str) -> list[dict]:
    body, charset = _aemet_datos(AEMET_URL, api_key)
    return json.loads(_decode(body, charset))


def _aemet_time(value: object) -> datetime | None:
    # "2026-09-29T15:00:00+0000"
    try:
        return datetime.strptime(str(value), "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        return None


def parse_aemet(rows: list[dict]) -> dict:
    """Each station's latest observation. A metric the latest hour didn't
    report stays missing rather than falling back to an older hour, so every
    value on the map is from the time its popup says. Stations that have
    stopped reporting (AEMET_STALE_AFTER) are left off."""
    latest: dict[str, dict] = {}
    for row in rows:
        station = row.get("idema")
        if not station or row.get("lat") is None or row.get("lon") is None:
            continue
        if station not in latest or row.get("fint", "") > latest[station].get("fint", ""):
            latest[station] = row
    times = {station: _aemet_time(row.get("fint")) for station, row in latest.items()}
    newest = max((t for t in times.values() if t), default=None)
    features: list[dict] = []
    observed: str | None = None
    for station, row in sorted(latest.items()):
        time_ = times[station]
        if newest is None or time_ is None or newest - time_ > AEMET_STALE_AFTER:
            continue
        if time_ == newest:
            observed = row.get("fint")
        properties = {
            "id": station,
            "name": row.get("ubi"),
            "alt": row.get("alt"),
            "time": row.get("fint"),
        }
        properties.update({f: row[f] for f in AEMET_FIELDS if isinstance(row.get(f), (int, float))})
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
                "properties": properties,
            }
        )
    return {
        "type": "FeatureCollection",
        "observed": observed,
        "features": features,
    }


# --- AEMET warnings (Meteoalerta) --------------------------------------------

_CAP = {"cap": "urn:oasis:names:tc:emergency:cap:1.2"}
# Meteoalerta levels. Green ("no warning") files are in the tarball too, and
# are dropped.
_LEVELS = {"amarillo": ("yellow", 1), "naranja": ("orange", 2), "rojo": ("red", 3)}


def aemet_warnings() -> dict:
    api_key = _aemet_key()
    return _cached(
        "aemet_warnings",
        AEMET_TTL_S,
        lambda: parse_aemet_warnings(
            _aemet_datos(AEMET_WARNINGS_URL, api_key)[0], datetime.now(UTC)
        ),
    )


def _cap_parameter(info: ET.Element, name: str) -> str | None:
    for parameter in info.iterfind("cap:parameter", _CAP):
        if parameter.findtext("cap:valueName", namespaces=_CAP) == name:
            return parameter.findtext("cap:value", namespaces=_CAP)
    return None


def _cap_detail(info: ET.Element) -> str | None:
    # "P1;Precipitación acumulada en una hora;20 mm" -> "Precipitación
    # acumulada en una hora: 20 mm"; "TO;Tormentas;" -> None (nothing the
    # event name doesn't already say).
    value = _cap_parameter(info, "AEMET-Meteoalerta parametro")
    parts = [p.strip() for p in (value or "").split(";")]
    if len(parts) < 3 or not parts[2]:
        return None
    return f"{parts[1]}: {parts[2]}"


def _cap_polygon(text: str) -> list[list[float]]:
    # CAP polygons are "lat,lon lat,lon ...", GeoJSON wants [lon, lat].
    ring = []
    for pair in text.split():
        lat, lon = pair.split(",")
        ring.append([float(lon), float(lat)])
    return ring


def _epoch_ms(value: str | None) -> int | None:
    try:
        return int(datetime.fromisoformat(value or "").timestamp() * 1000)
    except ValueError:
        return None


def _draw_order(feature: dict) -> tuple[int, str]:
    properties = feature["properties"]
    return properties["level_rank"], properties["onset"] or ""


def parse_aemet_warnings(tarball: bytes, now: datetime) -> dict:
    """One polygon feature per warned area and time slice, yellow and up,
    not yet expired. AEMET splits a zone's warning into consecutive slices
    (yellow 11-14 h, orange 14-18 h, ...) and by parameter (1 h and 12 h
    rainfall are separate warnings), so several features can cover the same
    zone at once: the frontend filters by time and draws the highest level
    on top. Spanish and English text both come from the alert itself."""
    features = []
    issued: str | None = None
    with tarfile.open(fileobj=io.BytesIO(tarball)) as archive:
        for member in archive:
            file = archive.extractfile(member) if member.isfile() else None
            if file is None:
                continue
            alert = ET.fromstring(file.read())
            if alert.findtext("cap:msgType", namespaces=_CAP) == "Cancel":
                continue
            infos = {
                i.findtext("cap:language", namespaces=_CAP): i
                for i in alert.iterfind("cap:info", _CAP)
            }
            # (Not `or`: an Element's truth value is its child count.)
            es = infos["es-ES"] if "es-ES" in infos else next(iter(infos.values()), None)
            if es is None:
                continue
            level = _LEVELS.get(_cap_parameter(es, "AEMET-Meteoalerta nivel") or "")
            expires_ms = _epoch_ms(es.findtext("cap:expires", namespaces=_CAP))
            if level is None or expires_ms is None or expires_ms <= now.timestamp() * 1000:
                continue
            en = infos.get("en-GB", es)
            sent = alert.findtext("cap:sent", namespaces=_CAP)
            issued = max(issued or "", sent or "") or None
            onset = es.findtext("cap:onset", namespaces=_CAP) or es.findtext(
                "cap:effective", namespaces=_CAP
            )
            phenomenon = (es.findtext("cap:eventCode/cap:value", namespaces=_CAP) or "").split(";")[
                0
            ]
            identifier = alert.findtext("cap:identifier", namespaces=_CAP)
            for index, area in enumerate(es.iterfind("cap:area", _CAP)):
                rings = [_cap_polygon(p.text) for p in area.iterfind("cap:polygon", _CAP) if p.text]
                if not rings:
                    continue
                geometry = (
                    {"type": "Polygon", "coordinates": rings}
                    if len(rings) == 1
                    else {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]}
                )
                properties = {
                    "id": f"{identifier}#{index}",
                    "level": level[0],
                    "level_rank": level[1],
                    "phenomenon": phenomenon,
                    "area": area.findtext("cap:areaDesc", namespaces=_CAP),
                    "zone": area.findtext("cap:geocode/cap:value", namespaces=_CAP),
                    "event_es": es.findtext("cap:event", namespaces=_CAP),
                    "event_en": en.findtext("cap:event", namespaces=_CAP),
                    "detail_es": _cap_detail(es),
                    "detail_en": _cap_detail(en),
                    "description_es": es.findtext("cap:description", namespaces=_CAP),
                    "description_en": en.findtext("cap:description", namespaces=_CAP),
                    "probability": _cap_parameter(es, "AEMET-Meteoalerta probabilidad"),
                    "onset": onset,
                    "expires": es.findtext("cap:expires", namespaces=_CAP),
                    # For the map's time filter.
                    "onset_ms": _epoch_ms(onset),
                    "expires_ms": expires_ms,
                    "sent": sent,
                }
                features.append({"type": "Feature", "geometry": geometry, "properties": properties})
    # Draw order: higher levels last, i.e. on top.
    features.sort(key=_draw_order)
    return {"type": "FeatureCollection", "issued": issued, "features": features}
