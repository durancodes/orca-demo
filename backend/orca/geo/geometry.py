"""Geodesy helpers: distances, bearings and polygon tests on lat/lon coordinates.

Polygons are given as [(lat, lon), ...] throughout ORCA; shapely works in
(x=lon, y=lat), so conversion happens only inside this module."""

from __future__ import annotations

import math
from functools import lru_cache

from shapely.geometry import LineString, Point, Polygon
from shapely.prepared import prep

EARTH_RADIUS_KM = 6371.0088
KM_PER_NM = 1.852

COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

LatLonPt = tuple[float, float]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compass16(bearing: float) -> str:
    return COMPASS16[int((bearing % 360) / 22.5 + 0.5) % 16]


def destination_point(lat: float, lon: float, bearing: float, distance_km: float) -> LatLonPt:
    d = distance_km / EARTH_RADIUS_KM
    b = math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def _to_xy(points: list[LatLonPt]) -> list[tuple[float, float]]:
    return [(lon, lat) for lat, lon in points]


@lru_cache(maxsize=512)
def _prepared_polygon(points: tuple[LatLonPt, ...]):
    poly = Polygon(_to_xy(list(points)))
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly, prep(poly)


def point_in_polygon(lat: float, lon: float, polygon: list[LatLonPt]) -> bool:
    if len(polygon) < 3:
        return False
    _, prepared = _prepared_polygon(tuple(polygon))
    return prepared.covers(Point(lon, lat))


def distance_to_polygon_km(lat: float, lon: float, polygon: list[LatLonPt]) -> float:
    """0 if inside; otherwise approximate distance to the polygon boundary (local projection)."""
    if point_in_polygon(lat, lon, polygon):
        return 0.0
    return distance_to_line_km(lat, lon, polygon)


def distance_to_line_km(lat: float, lon: float, line: list[LatLonPt]) -> float:
    """Approximate distance from a point to a polyline, using an equirectangular projection centred on the point."""
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 110.57
    best = float("inf")
    for (a_lat, a_lon), (b_lat, b_lon) in zip(line, line[1:]):
        ax, ay = (a_lon - lon) * kx, (a_lat - lat) * ky
        bx, by = (b_lon - lon) * kx, (b_lat - lat) * ky
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def segment_intersects_polygon(a: LatLonPt, b: LatLonPt, polygon: list[LatLonPt]) -> bool:
    if len(polygon) < 3:
        return False
    poly, prepared = _prepared_polygon(tuple(polygon))
    return prepared.intersects(LineString(_to_xy([a, b])))


def segment_crosses_line(a: LatLonPt, b: LatLonPt, line: list[LatLonPt]) -> bool:
    return LineString(_to_xy([a, b])).intersects(LineString(_to_xy(line)))


def polyline_length_km(points: list[LatLonPt]) -> float:
    return sum(haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(points, points[1:]))
