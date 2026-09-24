"""Replay adapter — serves the simulated scenario through the same interface as
live adapters (guide §9 'Mock adapter' / §37 'Historical replay mode').

Every observation is tagged data_type=simulated with the scenario as source,
so nothing downstream can mistake it for live government data."""

from __future__ import annotations

from datetime import datetime

from ..models import DataType, MarineObservation
from ..scenario import SCENARIO_SOURCE, Scenario
from ..timeutil import UTC, hours_between
from ..variables import VARIABLES, validate
from .base import MarineDataAdapter, PointQuery, RawPayload

PROCESSING_VERSION = "replay-normalizer/1"
REFERENCE = "docs/DATA_SOURCES.md#simulated-scenario"


class ReplayAdapter(MarineDataAdapter):
    name = "replay"
    mode = "replay"

    def __init__(self, scenario: Scenario) -> None:
        super().__init__()
        self.scenario = scenario

    def capabilities(self) -> list[str]:
        return sorted(v for v in VARIABLES)

    async def fetch(self, query: PointQuery) -> RawPayload:
        rows = [
            {"time": t, **self.scenario.fields(query.lat, query.lon, t)}
            for t in hours_between(query.start, query.end)
        ]
        return RawPayload(
            adapter=self.name,
            fetched_at=datetime.now(UTC),
            request={"lat": query.lat, "lon": query.lon},
            payload={"lat": query.lat, "lon": query.lon, "rows": rows, "variables": query.variables},
            reference=REFERENCE,
        )

    def normalize(self, raw: RawPayload) -> list[MarineObservation]:
        lat, lon = raw.payload["lat"], raw.payload["lon"]
        wanted = raw.payload.get("variables")
        out: list[MarineObservation] = []
        for row in raw.payload["rows"]:
            t: datetime = row["time"]
            for var, spec in VARIABLES.items():
                if wanted and var not in wanted:
                    continue
                value, flag = validate(var, row.get(var))
                out.append(
                    MarineObservation(
                        id=f"sim:{var}:{lat:.3f},{lon:.3f}:{t:%Y%m%dT%H}",
                        source=SCENARIO_SOURCE,
                        source_product=self.scenario.title,
                        lat=lat,
                        lon=lon,
                        retrieved_at=raw.fetched_at,
                        valid_time=t,
                        data_type=DataType.SIMULATED,
                        variable=var,
                        value=value,
                        unit=spec.unit,
                        quality_flag=flag,
                        spatial_resolution="analytic field (point-exact)",
                        processing_version=PROCESSING_VERSION,
                        reference=REFERENCE,
                    )
                )
        return out

    def values_at(self, lat: float, lon: float, t: datetime, variables: tuple[str, ...]) -> dict[str, MarineObservation]:
        """Synchronous single-hour lookup used by the lazily-evaluated route risk field."""
        raw = RawPayload(
            adapter=self.name,
            fetched_at=datetime.now(UTC),
            request={},
            payload={"lat": lat, "lon": lon, "rows": [{"time": t, **self.scenario.fields(lat, lon, t)}], "variables": variables},
        )
        return {o.variable: o for o in self.normalize(raw)}

    async def observe_many(
        self, points: list[tuple[float, float]], start: datetime, end: datetime
    ) -> dict[tuple[float, float], list[MarineObservation]]:
        variables = ("wave_height", "wind_speed", "weather_code", "visibility")
        return {p: await self.observe(PointQuery(p[0], p[1], start, end, variables)) for p in points}
