"""Traffic stretches as lines along the real road (ADR-0026).

The traffic feeds give a stretch as road + start/end km + (usually) its two
end points, never the road between them. This draws that part of the road
from IGN's network (pipelines/exposure roads.py): both ends are snapped
onto the road's own sections and joined by the shortest path through them,
junctions and slip roads counting triple so the path keeps to the main
line. A path much longer than the stretch's own km range is rejected (the
stretch stays a point), so a wrong match can't draw a detour.

Records with a road and km points but no coordinates (a quarter of the
SCT/DT-GV feeds) are placed from IGN's kilometre posts.

Roads are loaded on demand, only those with incidents, and kept; each
stretch's line is memoised by its location, so a refresh only routes new
stretches. Without the road files everything still works, as points.

**Disabled by default** (ADR-0026, "Stretches as lines"): IGN's national
roads file is missing ~20 provinces, so it's shelved until the
per-province files are merged in. `TWINER_TRAFFIC_LINES=1` turns it on;
otherwise realtime.py uses `points_only` below.
"""

from __future__ import annotations

import heapq
import math
import os
import threading
from dataclasses import dataclass

import numpy as np
import shapely
import shapely.ops
from scipy.spatial import (
    cKDTree,  # pyrefly: ignore -- no stub for this compiled extension re-export
)

# Metres per degree of latitude, and of longitude at the equator.
_M_PER_DEG = 111_320.0
# A feed's end point further than this from its road isn't on it.
SNAP_TOLERANCE_M = 500.0
# Sections this much further than the nearest are candidates too (the
# other carriageway of a dual road).
SNAP_EXTRA_M = 60.0
# Section ends closer than this are joined (pieces of the road that don't
# quite meet in IGN's network).
GAP_M = 25.0
# Junctions, roundabouts and service roads cost this much more per metre.
SIDE_PENALTY = 3.0
# Accept a path up to this long relative to the stretch's own length
# (the km range when given, else the straight line), plus some slack.
MAX_DETOUR = 1.6
DETOUR_SLACK_M = 1_500.0
# Two km posts with the same number further apart than this aren't a pair.
MAX_POST_GAP_M = 3_000.0


def _roads_dir() -> str:
    data_dir = os.environ.get("TWINER_DATA_DIR", "data")
    return os.environ.get("TWINER_ROADS_DIR", f"{data_dir}/roads")


def _metres(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * k, lat2 - lat1) * _M_PER_DEG


def _line_metres(coords: np.ndarray) -> float:
    if len(coords) < 2:
        return 0.0
    k = np.cos(np.radians(coords[:, 1].mean()))
    d = np.diff(coords, axis=0)
    return float(np.hypot(d[:, 0] * k, d[:, 1]).sum() * _M_PER_DEG)


@dataclass
class Road:
    """One road's sections as a graph: sections are edges between their
    end points (nodes, keyed by rounded coordinates). Section ends that
    don't quite meet (under GAP_M apart) are bridged by short straight
    edges, appended to `lines` like any section."""

    lines: np.ndarray  # of shapely LineString
    tree: shapely.STRtree
    weight: np.ndarray  # length in metres, with the side-road penalty
    ends: np.ndarray  # (n, 2) node ids of each line's first and last point
    adjacency: list[list[tuple[int, int]]]  # node -> [(line, other node)]
    posts_km: np.ndarray
    posts_xy: np.ndarray  # (m, 2) lon, lat

    @classmethod
    def build(
        cls, wkb: list[bytes], main: list[bool], posts: list[tuple[float, float, float]]
    ) -> Road:
        lines = list(shapely.from_wkb(wkb))
        coords = [np.asarray(shapely.get_coordinates(line)) for line in lines]
        nodes: dict[tuple[float, float], int] = {}

        def node(xy: np.ndarray) -> int:
            return nodes.setdefault((round(float(xy[0]), 6), round(float(xy[1]), 6)), len(nodes))

        ends = [[node(c[0]), node(c[-1])] for c in coords]
        weight = [
            _line_metres(c) * (1.0 if m else SIDE_PENALTY)
            for c, m in zip(coords, main, strict=True)
        ]

        # Bridges between nearby section ends that aren't the same node.
        xy = np.array(list(nodes), dtype=np.float64).reshape(-1, 2)
        if len(xy) > 1:
            k = math.cos(math.radians(float(xy[:, 1].mean())))
            pairs = cKDTree(xy * [k, 1.0]).query_pairs(GAP_M / _M_PER_DEG)
            for a, b in pairs:
                lines.append(shapely.LineString([xy[a], xy[b]]))
                ends.append([a, b])
                weight.append(_metres(*xy[a], *xy[b]) * SIDE_PENALTY)

        adjacency: list[list[tuple[int, int]]] = [[] for _ in range(len(nodes))]
        for i, (a, b) in enumerate(ends):
            adjacency[a].append((i, b))
            adjacency[b].append((i, a))
        posts_arr = np.array(posts, dtype=np.float64).reshape(-1, 3)
        line_arr = np.array(lines, dtype=object)
        return cls(
            lines=line_arr,
            tree=shapely.STRtree(line_arr),
            weight=np.array(weight),
            ends=np.array(ends, dtype=np.int64).reshape(-1, 2),
            adjacency=adjacency,
            posts_km=posts_arr[:, 0],
            posts_xy=posts_arr[:, 1:],
        )

    def candidates(self, lon: float, lat: float) -> list[tuple[int, float]]:
        """Sections a feed's point could be on: every one within SNAP_EXTRA_M
        of the nearest (both carriageways of a dual road, say), as (section,
        fraction along it). Empty if even the nearest is too far."""
        if len(self.lines) == 0:
            return []
        point = shapely.Point(lon, lat)
        d = SNAP_TOLERANCE_M / (_M_PER_DEG * math.cos(math.radians(lat)))
        index = self.tree.query(shapely.box(lon - d, lat - d, lon + d, lat + d))
        if len(index) == 0:
            return []
        lines = self.lines[index]
        nearest = shapely.line_interpolate_point(lines, shapely.line_locate_point(lines, point))
        dist = np.array([_metres(lon, lat, p.x, p.y) for p in nearest])
        best = dist.min()
        if best > SNAP_TOLERANCE_M:
            return []
        keep = dist <= best + SNAP_EXTRA_M
        t = shapely.line_locate_point(lines[keep], point, normalized=True)
        return [(int(i), float(f)) for i, f in zip(index[keep], np.atleast_1d(t), strict=True)]

    def km_point(self, km: float) -> tuple[float, float] | None:
        """Where kilometre `km` is: between its two surrounding posts."""
        whole = math.floor(km)
        below = self.posts_xy[self.posts_km == whole]
        above = self.posts_xy[self.posts_km == whole + 1]
        if len(below) == 0:
            return None
        if len(above) == 0 or km == whole:
            return float(below[0][0]), float(below[0][1])
        # A road's posts come in pairs (one per direction) and a code can be
        # reused far away: take the closest below/above pair.
        gap, i, j = min(
            (_metres(*b, *a), i, j) for i, b in enumerate(below) for j, a in enumerate(above)
        )
        if gap > MAX_POST_GAP_M:
            return float(below[i][0]), float(below[i][1])
        lon, lat = below[i] + (km - whole) * (above[j] - below[i])
        return float(lon), float(lat)

    def path(
        self, start: tuple[float, float], end: tuple[float, float], expected_m: float
    ) -> list | None:
        """Coordinates along the road from `start` to `end`, or None."""
        starts, ends = self.candidates(*start), self.candidates(*end)
        if not starts or not ends:
            return None
        limit = MAX_DETOUR * expected_m + DETOUR_SLACK_M
        w = self.weight

        # Both on one section: just the piece between them.
        direct = min(
            (
                (abs(ta - tb) * w[ia], ia, ta, tb)
                for ia, ta in starts
                for ib, tb in ends
                if ia == ib
            ),
            default=None,
        )

        # Dijkstra from every start candidate (a virtual point partway along
        # its section) to either end of any end candidate's section.
        end_cost: dict[int, tuple[float, int, float]] = {}
        for ib, tb in ends:
            for n, c in (
                (int(self.ends[ib][0]), tb * w[ib]),
                (int(self.ends[ib][1]), (1 - tb) * w[ib]),
            ):
                if n not in end_cost or c < end_cost[n][0]:
                    end_cost[n] = (c, ib, tb)
        start_lines = {ia for ia, _ in starts}
        heap: list[
            tuple[float, int, int, int, int]
        ] = []  # cost, node, via line, from node, start index
        for k, (ia, ta) in enumerate(starts):
            heap.append((ta * w[ia], int(self.ends[ia][0]), -1, -1, k))
            heap.append(((1 - ta) * w[ia], int(self.ends[ia][1]), -1, -1, k))
        heapq.heapify(heap)
        settled: dict[int, tuple[int, int, int]] = {}  # node -> (via line, from node, start index)
        found: tuple[float, int] | None = None
        bound = min(SIDE_PENALTY * limit, direct[0] if direct else math.inf)
        while heap:
            cost, n, via, from_node, origin = heapq.heappop(heap)
            if n in settled:
                continue
            if cost > bound or (found is not None and cost >= found[0]):
                break
            settled[n] = (via, from_node, origin)
            if n in end_cost:
                total = cost + end_cost[n][0]
                if found is None or total < found[0]:
                    found = (total, n)
            for line, other in self.adjacency[n]:
                if other not in settled and line not in start_lines:
                    heapq.heappush(heap, (cost + w[line], other, line, n, origin))

        if direct is not None and (found is None or direct[0] <= found[0]):
            _, ia, ta, tb = direct
            return _checked(_substring(self.lines[ia], ta, tb), limit)
        if found is None:
            return None

        # Back from the exit node to its start candidate, then assemble.
        exit_node = found[1]
        _, ib, tb = end_cost[exit_node]
        steps: list[tuple[int, int]] = []  # (line, from node)
        n = exit_node
        while settled[n][0] >= 0:
            via, from_node, _ = settled[n]
            steps.append((via, from_node))
            n = from_node
        steps.reverse()
        ia, ta = starts[settled[n][2]]
        pieces = [_substring(self.lines[ia], ta, 0.0 if int(self.ends[ia][0]) == n else 1.0)]
        for line, from_node in steps:
            coords = np.asarray(shapely.get_coordinates(self.lines[line]))
            pieces.append(coords if int(self.ends[line][0]) == from_node else coords[::-1])
        pieces.append(
            _substring(self.lines[ib], 0.0 if int(self.ends[ib][0]) == exit_node else 1.0, tb)
        )
        return _checked(np.concatenate([p for p in pieces if len(p)]), limit)


def _substring(line: shapely.LineString, t0: float, t1: float) -> np.ndarray:
    """Coordinates of `line` from fraction t0 to t1 (reversed if t1 < t0)."""
    lo, hi = sorted((t0, t1))
    piece = shapely.ops.substring(line, lo, hi, normalized=True)
    coords = np.asarray(shapely.get_coordinates(piece))
    return coords if t0 <= t1 else coords[::-1]


def _checked(coords: np.ndarray, limit_m: float) -> list | None:
    if len(coords) < 2:
        return None
    # Consecutive duplicates (where pieces meet) are harmless but useless.
    keep = np.ones(len(coords), dtype=bool)
    keep[1:] = np.any(np.diff(coords, axis=0) != 0, axis=1)
    coords = coords[keep]
    if len(coords) < 2 or _line_metres(coords) > limit_m:
        return None
    return np.round(coords, 6).tolist()


# --- Loading and memoisation -------------------------------------------------

_roads: dict[str, Road | None] = {}
_lines: dict[tuple, list | None] = {}
_lock = threading.Lock()
_MAX_MEMO = 20_000


def _load(names: set[str]) -> None:
    """Loads the named roads that aren't loaded yet (None for unknown ones,
    or all of them when the road files aren't there)."""
    missing = sorted(n for n in names if n not in _roads)
    if not missing:
        return
    import duckdb

    from .db import ensure_httpfs, get_connection

    base = _roads_dir()
    con = get_connection()
    if base.startswith("s3://"):
        ensure_httpfs(con)
    try:
        links = con.execute(
            "SELECT road, main, wkb FROM read_parquet(?) WHERE road IN (SELECT unnest(?))",
            [f"{base}/road_links.parquet", missing],
        ).fetchall()
        posts = con.execute(
            "SELECT road, km, lon, lat FROM read_parquet(?) WHERE road IN (SELECT unnest(?))",
            [f"{base}/road_km_posts.parquet", missing],
        ).fetchall()
    except duckdb.IOException:
        links, posts = [], []
    by_road: dict[str, tuple[list, list, list]] = {n: ([], [], []) for n in missing}
    for road, main, wkb in links:
        by_road[road][0].append(wkb)
        by_road[road][1].append(main)
    for road, km, lon, lat in posts:
        by_road[road][2].append((km, lon, lat))
    for name, (wkb, main, road_posts) in by_road.items():
        _roads[name] = Road.build(wkb, main, road_posts) if wkb else None


def _road_key(name: str | None) -> str | None:
    key = (name or "").strip().upper()
    return key or None


def enabled() -> bool:
    return os.environ.get("TWINER_TRAFFIC_LINES") == "1"


def points_only(features: list[dict]) -> list[dict]:
    """What `locate` does without the road network: drop the private end
    points, and the records that have no coordinates of their own."""
    out = []
    for feature in features:
        feature["properties"].pop("_from", None)
        feature["properties"].pop("_to", None)
        if feature.get("geometry") is not None:
            out.append(feature)
    return out


def locate(features: list[dict]) -> list[dict]:
    """Adds each stretch's line (a LineString feature after its point) and
    places records without coordinates from km posts; drops those that
    still have no location. Features carry their feed's end points in the
    private `_from`/`_to` properties, removed here."""
    with _lock:
        _load({k for f in features if (k := _road_key(f["properties"].get("road")))})
        if len(_lines) > _MAX_MEMO:
            _lines.clear()
        out = []
        for feature in features:
            props = feature["properties"]
            start, end = props.pop("_from", None), props.pop("_to", None)
            road = _roads.get(_road_key(props.get("road")) or "")
            km_from, km_to = _float(props.get("km_from")), _float(props.get("km_to"))
            if road is not None:
                # Some records repeat one point as both ends while their km
                # range says otherwise: trust the km posts for those.
                if (
                    start is not None
                    and end is not None
                    and km_from is not None
                    and km_to is not None
                    and _metres(*start, *end) < 50
                    and abs(km_to - km_from) >= 0.2
                ):
                    start, end = road.km_point(km_from) or start, road.km_point(km_to) or end
                if start is None and km_from is not None:
                    start = road.km_point(km_from)
                if end is None and km_to is not None:
                    end = road.km_point(km_to)
            if feature.get("geometry") is None:
                if start is None:
                    continue
                feature["geometry"] = {
                    "type": "Point",
                    "coordinates": [round(start[0], 6), round(start[1], 6)],
                }
            out.append(feature)
            if road is None or start is None or end is None:
                continue
            key = (
                props.get("road"),
                tuple(np.round(start, 5)),
                tuple(np.round(end, 5)),
                km_from,
                km_to,
            )
            if key not in _lines:
                expected = (
                    abs(km_to - km_from) * 1000
                    if km_from is not None and km_to is not None
                    else _metres(*start, *end)
                )
                _lines[key] = road.path(
                    tuple(start), tuple(end), max(expected, _metres(*start, *end))
                )
            if _lines[key] is not None:
                out.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": _lines[key]},
                        "properties": props,
                    }
                )
        return out


def _float(value: object) -> float | None:
    try:
        return float(value) if value is not None else None  # type: ignore[arg-type]
    except ValueError:
        return None
