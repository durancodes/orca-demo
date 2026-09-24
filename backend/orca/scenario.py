"""Simulated demo scenario (guide §37–38: replay / scenario simulation).

THIS IS SYNTHETIC DATA. It exists so the full ORCA pipeline can be demonstrated
and tested when live sources are unreachable (e.g. during judging or in CI).
Every value it produces is tagged data_type=simulated and the UI shows a
"SIMULATED" banner. Nothing here may be presented as real INCOIS/IMD/ISRO data.

Story: a depression over the east-central Arabian Sea moves north-east towards
the Konkan–Goa coast. Offshore waters near 15.2N 72.8E are calm at dawn on
scenario day 1, turn moderate by ~08:00 IST and rough by ~10:00 IST, while
near-shore waters stay calmer for longer. The storm geometry is a simple
parametric wind field; waves follow a fetch-limited wind–wave relation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from global_land_mask import globe

from .models import Advisory, DataType
from .timeutil import UTC, ensure_utc

SCENARIO_NAME = "arabian-sea-depression"
SCENARIO_TITLE = "Simulated scenario: depression over the east-central Arabian Sea"
SCENARIO_SOURCE = "ORCA simulated scenario"

# Approximate coastline polylines — used only to shape simulated fields (not for navigation).
WEST_COAST = [
    (8.08, 77.55), (8.90, 76.55), (9.95, 76.25), (11.25, 75.77), (12.87, 74.84), (14.80, 74.10),
    (15.40, 73.80), (16.99, 73.30), (18.95, 72.82), (20.40, 72.83), (21.60, 72.60), (20.90, 70.40),
    (22.30, 68.97), (23.00, 70.20),
]
EAST_COAST = [
    (8.08, 77.55), (8.80, 78.15), (9.28, 79.30), (10.77, 79.84), (11.93, 79.83), (13.08, 80.29),
    (14.25, 80.12), (16.17, 81.13), (16.93, 82.25), (17.69, 83.30), (19.26, 84.90), (20.26, 86.67),
    (21.50, 87.00), (21.64, 88.10),
]

# Storm track: hours after anchor (00:00 IST, scenario day 1) -> (lat, lon, vmax km/h)
TRACK: list[tuple[float, float, float, float]] = [
    (-48.0, 10.8, 65.8, 30.0),
    (-24.0, 12.0, 67.5, 38.0),
    (0.0, 13.2, 69.3, 46.0),
    (6.0, 13.8, 70.2, 50.0),
    (12.0, 14.4, 71.0, 58.0),
    (24.0, 15.4, 71.9, 65.0),
    (36.0, 16.6, 72.3, 55.0),
    (48.0, 18.0, 72.0, 40.0),
    (72.0, 20.0, 71.0, 25.0),
    (120.0, 22.0, 69.0, 12.0),
]
GALE_EDGE_KM = 290.0  # radius where the storm's added wind is at half strength
EDGE_WIDTH_KM = 31.0
CORE_RADIUS_KM = 45.0
BASE_WIND_KMH = 14.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _dist_to_polyline_km(lat: float, lon: float, line: list[tuple[float, float]]) -> float:
    best = float("inf")
    for (a_lat, a_lon), (b_lat, b_lon) in zip(line, line[1:]):
        # equirectangular projection around the point is plenty for shaping fields
        kx = 111.32 * math.cos(math.radians(lat))
        ax, ay = (a_lon - lon) * kx, (a_lat - lat) * 110.57
        bx, by = (b_lon - lon) * kx, (b_lat - lat) * 110.57
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(px, py))
    return best


def _pseudo_noise(lat: float, lon: float, h: float) -> float:
    """Deterministic small-amplitude variation in [-1, 1]."""
    return math.sin(lat * 12.9898 + lon * 78.233 + h * 0.37) * math.cos(lat * 3.1 - lon * 1.7 + h * 0.11)


@dataclass(frozen=True)
class StormState:
    lat: float
    lon: float
    vmax_kmh: float


class Scenario:
    """Parametric simulated ocean/weather fields anchored to a calendar day."""

    name = SCENARIO_NAME
    title = SCENARIO_TITLE

    def __init__(self, anchor: datetime) -> None:
        self.anchor = ensure_utc(anchor)  # 00:00 IST of scenario day 1, in UTC

    def hour_of(self, t: datetime) -> float:
        return (ensure_utc(t) - self.anchor).total_seconds() / 3600.0

    def storm(self, h: float) -> StormState:
        if h <= TRACK[0][0]:
            _, lat, lon, v = TRACK[0]
            return StormState(lat, lon, v)
        for (h0, la0, lo0, v0), (h1, la1, lo1, v1) in zip(TRACK, TRACK[1:]):
            if h0 <= h <= h1:
                f = (h - h0) / (h1 - h0)
                return StormState(la0 + f * (la1 - la0), lo0 + f * (lo1 - lo0), v0 + f * (v1 - v0))
        _, lat, lon, v = TRACK[-1]
        return StormState(lat, lon, v)

    def _storm_wind(self, lat: float, lon: float, h: float) -> tuple[float, float]:
        s = self.storm(h)
        r = haversine_km(lat, lon, s.lat, s.lon)
        edge = 1.0 / (1.0 + math.exp((r - GALE_EDGE_KM) / EDGE_WIDTH_KM))
        core = min(1.0, r / CORE_RADIUS_KM)
        return s.vmax_kmh * edge * core, r

    def wind_speed(self, lat: float, lon: float, h: float) -> float:
        storm_w, _ = self._storm_wind(lat, lon, h)
        base = BASE_WIND_KMH + 2.5 * math.sin(2 * math.pi * (h - 14) / 24) + 1.0 * _pseudo_noise(lat, lon, h)
        return math.hypot(base, storm_w)

    def is_sea(self, lat: float, lon: float) -> bool:
        return not globe.is_land(lat, lon)

    def fields(self, lat: float, lon: float, t: datetime) -> dict[str, float | None]:
        h = self.hour_of(t)
        s = self.storm(h)
        wind = self.wind_speed(lat, lon, h)
        storm_w, r = self._storm_wind(lat, lon, h)
        wind_lag = self.wind_speed(lat, lon, h - 1.0)
        u_ms = wind_lag / 3.6
        wind_sea = 0.0165 * u_ms * u_ms
        swell = 0.35 + 1.5 * (s.vmax_kmh / 65.0) * math.exp(-max(r - 100.0, 0.0) / 350.0)
        wave = math.hypot(wind_sea, swell)
        gusts = wind * (1.35 + 0.1 * (storm_w / max(s.vmax_kmh, 1.0)))

        # cyclonic (anticlockwise, NH) inflow direction near the storm, SW monsoon flow elsewhere
        bearing_to_centre = math.degrees(math.atan2(s.lon - lon, s.lat - lat)) % 360
        storm_dir = (bearing_to_centre + 180 + 90 - 20) % 360  # wind blows FROM this direction
        weight = min(1.0, storm_w / max(wind, 1.0))
        direction = ((1 - weight) * 250.0 + weight * storm_dir) % 360

        in_band = (GALE_EDGE_KM - 110.0) <= r <= (GALE_EDGE_KM - 20.0) and s.vmax_kmh >= 45.0
        in_core = r < (GALE_EDGE_KM - 110.0) and s.vmax_kmh >= 45.0
        in_rain = r < GALE_EDGE_KM + 60.0 and s.vmax_kmh >= 35.0
        if in_band or in_core:
            code, vis, rain, cape = 95.0, 2500.0 if in_band else 900.0, 9.0 if in_band else 14.0, 2600.0
        elif in_rain:
            code, vis, rain, cape = 63.0, 6000.0, 2.5, 1400.0
        else:
            code, vis, rain, cape = 2.0, 20000.0, 0.0, 700.0

        d_west = _dist_to_polyline_km(lat, lon, WEST_COAST)
        d_east = _dist_to_polyline_km(lat, lon, EAST_COAST)
        east_side = lon > 78.0 or (lat < 9.5 and lon > 77.6)
        d_coast = d_east if east_side else d_west

        sst = (29.2 if east_side else 28.5 - 0.03 * (lat - 8.0)) - (0.0 if east_side else 1.3 * math.exp(-d_west / 70.0))
        sst -= 0.9 * math.exp(-(r / 160.0) ** 2) * min(1.0, max(0.0, (h + 12.0) / 24.0))  # storm cooling
        sst += 0.15 * _pseudo_noise(lat, lon, 0.0)
        chl = 0.12 + (1.1 if east_side else 2.3) * math.exp(-d_coast / 55.0)
        for pz in DEMO_PFZ_CENTRES:
            chl += 0.9 * math.exp(-((haversine_km(lat, lon, pz[1], pz[2]) / 18.0) ** 2))

        if lat > 20.8 and 71.8 < lon < 73.0:
            tide_amp = 2.8  # Gulf of Khambhat macro-tides
        elif east_side:
            tide_amp = 0.45
        else:
            tide_amp = 0.95
        hours_utc = (ensure_utc(t) - datetime(2026, 1, 1, tzinfo=UTC)).total_seconds() / 3600.0
        sea_level = tide_amp * math.cos(2 * math.pi * hours_utc / 12.42 + lon / 12.0)
        current = 0.6 + 0.9 * (storm_w / 65.0) + 0.35 * abs(math.sin(2 * math.pi * hours_utc / 12.42))

        sea = self.is_sea(lat, lon)
        marine = lambda v: round(v, 2) if sea else None  # noqa: E731 — marine model has no value over land
        return {
            "wave_height": marine(wave),
            "swell_wave_height": marine(swell),
            "wave_period": marine(5.0 + 1.8 * wave),
            "sea_surface_temperature": marine(sst),
            "chlorophyll": marine(chl),
            "current_speed": marine(current),
            "sea_level": marine(sea_level),
            "wind_speed": round(wind, 1),
            "wind_gusts": round(gusts, 1),
            "wind_direction": round(direction),
            "weather_code": code,
            "visibility": vis,
            "precipitation": rain,
            "cape": cape,
            "distance_to_coast_km": round(d_coast, 1),
        }

    # ---- advisories -----------------------------------------------------------------
    def advisories(self, now: datetime) -> list[Advisory]:
        """A simulated storm warning polygon — explicitly NOT an IMD bulletin."""
        now = ensure_utc(now)
        issued = self.anchor - timedelta(hours=10)
        if now < issued:
            return []
        onset, expires = self.anchor + timedelta(hours=10), self.anchor + timedelta(hours=48)
        ring = self._warning_ring(8.0, 40.0)
        return [
            Advisory(
                id=f"sim-adv:{SCENARIO_NAME}:depression",
                source=f"{SCENARIO_SOURCE} (simulated — NOT an IMD bulletin)",
                data_type=DataType.SIMULATED,
                event="Depression — squally weather (simulated)",
                headline="SIMULATED: Squally weather and rough seas expected over east-central Arabian Sea",
                description=(
                    "Simulated scenario advisory for demonstration. Winds 45–65 km/h and rough to very rough seas "
                    "expected within the marked area."
                ),
                severity="Severe",
                urgency="Expected",
                certainty="Likely",
                onset=onset,
                expires=expires,
                sent=issued,
                area_desc="East-central Arabian Sea off Goa–Konkan (simulated)",
                polygons=[ring],
                reference="docs/DATA_SOURCES.md#simulated-scenario",
                retrieved_at=now,
            )
        ]

    def _warning_ring(self, h_from: float, h_to: float, radius_km: float = 230.0) -> list[tuple[float, float]]:
        from shapely.geometry import LineString

        pts = [(self.storm(h).lon, self.storm(h).lat) for h in range(int(h_from), int(h_to) + 1, 4)]
        area = LineString(pts).buffer(radius_km / 105.0, quad_segs=6).simplify(0.05)
        return [(round(y, 3), round(x, 3)) for x, y in area.exterior.coords]

    # ---- history (for "why did productivity decline?") ------------------------------
    def daily_history(self, lat: float, lon: float, days: int = 60) -> list[dict]:
        """Simulated daily SST/chlorophyll history; a marine heatwave off Kerala in the last 21 days."""
        out = []
        in_heatwave_region = 8.3 <= lat <= 11.8 and 74.3 <= lon <= 76.6
        for d in range(days, 0, -1):
            t = self.anchor - timedelta(days=d)
            base = self.fields(lat, lon, t.replace(hour=6))
            sst, chl = base["sea_surface_temperature"], base["chlorophyll"]
            if sst is None or chl is None:
                return []
            anomaly_sst, chl_factor = 0.0, 1.0
            if in_heatwave_region and d <= 21:
                ramp = min(1.0, (22 - d) / 7.0)
                anomaly_sst, chl_factor = 1.5 * ramp, 1.0 - 0.55 * ramp
            out.append(
                {
                    "date": (t + timedelta(hours=6)).date().isoformat(),
                    "sea_surface_temperature": round(sst + anomaly_sst + 0.1 * _pseudo_noise(lat, lon, d), 2),
                    "chlorophyll": round(chl * chl_factor * (1 + 0.05 * _pseudo_noise(lon, lat, d)), 3),
                }
            )
        return out


# Demo PFZ centres (id, lat, lon, label) — simulated chlorophyll fronts, NOT INCOIS advisories.
DEMO_PFZ_CENTRES: list[tuple[str, float, float, str]] = [
    ("DEMO-PFZ-01", 15.45, 73.35, "Off Goa (Mormugao) — near-shore front"),
    ("DEMO-PFZ-02", 15.05, 72.55, "Offshore Goa — shelf-edge front"),
    ("DEMO-PFZ-03", 14.35, 73.85, "Off Karwar"),
    ("DEMO-PFZ-04", 16.60, 72.95, "Off Ratnagiri"),
    ("DEMO-PFZ-05", 12.75, 74.35, "Off Mangaluru"),
    ("DEMO-PFZ-06", 10.20, 75.70, "Off Kochi"),
    ("DEMO-PFZ-07", 18.70, 72.35, "Off Mumbai"),
    ("DEMO-PFZ-08", 13.15, 80.65, "Off Chennai"),
    ("DEMO-PFZ-09", 17.45, 83.75, "Off Visakhapatnam"),
    ("DEMO-PFZ-10", 9.75, 79.35, "Palk Bay (Indian side)"),
]
