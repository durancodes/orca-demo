"""Open-Meteo adapter — live, keyless weather + marine forecasts.

Weather:  https://api.open-meteo.com/v1/forecast       (wind, gusts, weather code, visibility, rain, CAPE)
Marine:   https://marine-api.open-meteo.com/v1/marine  (waves, swell, SST, currents, sea level incl. tide)

Both are model forecasts (data_type=forecast), not observations. Values are the
nearest model grid cell to the requested point; the snapped cell is recorded."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

import httpx

from ..models import DataType, MarineObservation
from ..timeutil import UTC, ensure_utc
from ..variables import VARIABLES, validate
from .base import AdapterError, MarineDataAdapter, PointQuery, RawPayload

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

# source variable -> canonical variable
WEATHER_VARS = {
    "wind_speed_10m": "wind_speed",
    "wind_gusts_10m": "wind_gusts",
    "wind_direction_10m": "wind_direction",
    "weather_code": "weather_code",
    "visibility": "visibility",
    "precipitation": "precipitation",
    "cape": "cape",
}
MARINE_VARS = {
    "wave_height": "wave_height",
    "wave_period": "wave_period",
    "swell_wave_height": "swell_wave_height",
    "sea_surface_temperature": "sea_surface_temperature",
    "ocean_current_velocity": "current_speed",
    "sea_level_height_msl": "sea_level",
}
PROCESSING_VERSION = "open-meteo-normalizer/1"
BATCH_SIZE = 50  # locations per multi-coordinate request


class OpenMeteoAdapter(MarineDataAdapter):
    name = "open-meteo"
    mode = "live"

    def __init__(self, client: httpx.AsyncClient | None = None, timeout_s: float = 12.0) -> None:
        super().__init__()
        self._client = client
        self._timeout = timeout_s

    def capabilities(self) -> list[str]:
        return sorted(set(WEATHER_VARS.values()) | set(MARINE_VARS.values()))

    async def _get(self, url: str, params: dict[str, Any]) -> Any:
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                raise AdapterError(self.name, f"HTTP {resp.status_code} from {url}: {resp.text[:200]}")
            return resp.json()
        finally:
            if self._client is None:
                await client.aclose()

    @staticmethod
    def _params(lats: list[float], lons: list[float], start: datetime, end: datetime, hourly: list[str]) -> dict[str, Any]:
        return {
            "latitude": ",".join(f"{v:.4f}" for v in lats),
            "longitude": ",".join(f"{v:.4f}" for v in lons),
            "hourly": ",".join(hourly),
            "timezone": "GMT",
            "start_date": ensure_utc(start).strftime("%Y-%m-%d"),
            "end_date": ensure_utc(end).strftime("%Y-%m-%d"),
        }

    async def _fetch_points(self, points: list[tuple[float, float]], start: datetime, end: datetime) -> dict[str, Any]:
        lats = [p[0] for p in points]
        lons = [p[1] for p in points]
        weather_params = self._params(lats, lons, start, end, list(WEATHER_VARS)) | {"cell_selection": "sea"}
        marine_params = self._params(lats, lons, start, end, list(MARINE_VARS))
        weather, marine = await asyncio.gather(
            self._get(FORECAST_URL, weather_params),
            self._get(MARINE_URL, marine_params),
        )
        # A single location returns an object; several return a list.
        if isinstance(weather, dict):
            weather = [weather]
        if isinstance(marine, dict):
            marine = [marine]
        return {"points": points, "weather": weather, "marine": marine}

    async def fetch(self, query: PointQuery) -> RawPayload:
        payload = await self._fetch_points([(query.lat, query.lon)], query.start, query.end)
        return RawPayload(
            adapter=self.name,
            fetched_at=datetime.now(UTC),
            request={"lat": query.lat, "lon": query.lon, "start": query.start.isoformat(), "end": query.end.isoformat()},
            payload=payload | {"start": query.start, "end": query.end},
            reference=FORECAST_URL,
        )

    def normalize(self, raw: RawPayload) -> list[MarineObservation]:
        payload = raw.payload
        observations: list[MarineObservation] = []
        start = ensure_utc(payload["start"]) if payload.get("start") else None
        end = ensure_utc(payload["end"]) if payload.get("end") else None
        for idx, (req_lat, req_lon) in enumerate(payload["points"]):
            for block, mapping, product, url in (
                (payload["weather"], WEATHER_VARS, "Open-Meteo weather forecast (best-match model)", FORECAST_URL),
                (payload["marine"], MARINE_VARS, "Open-Meteo marine forecast (best-match wave model)", MARINE_URL),
            ):
                if idx >= len(block):
                    continue
                observations.extend(
                    _normalize_block(block[idx], mapping, product, url, raw.fetched_at, req_lat, req_lon, start, end)
                )
        return observations

    async def observe_many(
        self, points: list[tuple[float, float]], start: datetime, end: datetime
    ) -> dict[tuple[float, float], list[MarineObservation]]:
        """Batch multi-coordinate fetch for route planning grids."""
        out: dict[tuple[float, float], list[MarineObservation]] = {}
        for i in range(0, len(points), BATCH_SIZE):
            chunk = points[i : i + BATCH_SIZE]
            raw = RawPayload(
                adapter=self.name,
                fetched_at=datetime.now(UTC),
                request={"points": len(chunk)},
                payload=(await self._fetch_points(chunk, start, end)) | {"start": start, "end": end},
            )
            observations = self.normalize(raw)
            for p in chunk:
                out[p] = [o for o in observations if (o.lat, o.lon) == p]
        return out


def _normalize_block(
    block: dict[str, Any],
    mapping: dict[str, str],
    product: str,
    url: str,
    fetched_at: datetime,
    req_lat: float,
    req_lon: float,
    start: datetime | None,
    end: datetime | None,
) -> list[MarineObservation]:
    hourly = block.get("hourly") or {}
    times = hourly.get("time") or []
    grid = f"model cell {block.get('latitude')},{block.get('longitude')}"
    out: list[MarineObservation] = []
    for src_var, canonical in mapping.items():
        values = hourly.get(src_var)
        if values is None:
            continue
        unit = VARIABLES[canonical].unit
        for t_str, raw_value in zip(times, values):
            valid_time = ensure_utc(datetime.fromisoformat(t_str))
            if (start and valid_time < start.replace(minute=0, second=0, microsecond=0)) or (end and valid_time > end):
                continue
            value, flag = validate(canonical, None if raw_value is None else float(raw_value))
            out.append(
                MarineObservation(
                    id=f"om:{canonical}:{req_lat:.3f},{req_lon:.3f}:{valid_time:%Y%m%dT%H}",
                    source="Open-Meteo",
                    source_product=product,
                    lat=req_lat,
                    lon=req_lon,
                    retrieved_at=fetched_at,
                    valid_time=valid_time,
                    data_type=DataType.FORECAST,
                    variable=canonical,
                    value=value,
                    unit=unit,
                    quality_flag=flag,
                    spatial_resolution=grid,
                    processing_version=PROCESSING_VERSION,
                    reference=url,
                )
            )
    return out
