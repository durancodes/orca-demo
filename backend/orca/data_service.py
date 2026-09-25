"""Data service: picks adapters by mode and records exactly what was used.

Modes (ORCA_DATA_MODE):
  live       — live adapters only; failures surface as missing data (never faked)
  historical — real archived data (NOAA GFS/GFS-Wave runs as issued, OISST, VIIRS,
               IMD CAP warnings) replayed as of a past moment, with no look-ahead
  replay     — simulated scenario only (clearly labelled)
  auto   — live first; if the live marine source fails, fall back to the
           simulated scenario and say so in every response (guide §33:
           'fallback demo dataset in case external services fail')

Real official advisories (IMD CAP) are always attempted and always labelled."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from pydantic import BaseModel, Field

from .adapters.advisories import AdvisoryAdapter
from .adapters.base import AdapterError, MarineDataAdapter, PointQuery
from .models import AdapterHealth, Advisory, MarineObservation
from .state import MarineState
from .timeutil import Clock

log = logging.getLogger("orca.data")

ROUTE_VARIABLES = ("wave_height", "wind_speed", "weather_code", "visibility")


class DataStatus(BaseModel):
    mode: str
    marine_source: str  # live | historical | replay | none
    fallback_reason: str | None = None
    advisory_sources: list[str] = Field(default_factory=list)
    advisory_errors: list[str] = Field(default_factory=list)


@dataclass
class DataService:
    mode: str
    live_marine: MarineDataAdapter
    replay_marine: MarineDataAdapter
    live_advisories: list[AdvisoryAdapter]
    replay_advisories: list[AdvisoryAdapter]
    clock: Clock
    historical_marine: MarineDataAdapter | None = None
    historical_advisories: list[AdvisoryAdapter] = field(default_factory=list)
    breaker_s: float = 60.0  # auto mode: after a live failure, skip live for this long
    _last_status: DataStatus | None = field(default=None, init=False)
    _live_down_until: float = field(default=0.0, init=False)
    _live_down_reason: str | None = field(default=None, init=False)

    async def _marine(self, query: PointQuery) -> tuple[list[MarineObservation], str, str | None]:
        if self.mode == "historical" and self.historical_marine is not None:
            return await self.historical_marine.observe(query), "historical", None
        if self.mode == "replay":
            return await self.replay_marine.observe(query), "replay", None
        if self.mode == "auto" and time.monotonic() < self._live_down_until:
            return await self.replay_marine.observe(query), "replay", f"{self._live_down_reason} (retrying live shortly)"
        try:
            observations = await self.live_marine.observe(query)
            self._live_down_until = 0.0
            return observations, "live", None
        except AdapterError as exc:
            if self.mode == "live":
                log.warning("live marine source failed: %s", exc)
                return [], "none", str(exc)
            log.warning("live marine source failed, using simulated scenario: %s", exc)
            self._live_down_until = time.monotonic() + self.breaker_s
            self._live_down_reason = str(exc)
            return await self.replay_marine.observe(query), "replay", str(exc)

    async def advisories(self, marine_source: str) -> tuple[list[Advisory], list[str], list[str]]:
        adapters: list[AdvisoryAdapter] = []
        if self.mode in ("live", "auto"):
            adapters += self.live_advisories
        if marine_source == "replay":
            adapters += self.replay_advisories
        if marine_source == "historical":
            adapters += self.historical_advisories
        now = self.clock()
        results = await asyncio.gather(*(a.fetch_advisories(now) for a in adapters), return_exceptions=True)
        advisories: list[Advisory] = []
        used, errors = [], []
        for adapter, res in zip(adapters, results):
            if isinstance(res, Exception):
                errors.append(f"{adapter.name}: {res}")
            else:
                used.append(adapter.name)
                advisories.extend(res)
        return advisories, used, errors

    async def marine_state(self, lat: float, lon: float, start: datetime, end: datetime) -> tuple[MarineState, DataStatus]:
        observations, source, reason = await self._marine(PointQuery(lat, lon, start, end))
        advisories, used, errors = await self.advisories(source)
        status = DataStatus(
            mode=self.mode, marine_source=source, fallback_reason=reason, advisory_sources=used, advisory_errors=errors
        )
        self._last_status = status
        return MarineState(lat, lon, observations, advisories), status

    async def route_values(
        self,
        points: list[tuple[float, float]],
        start: datetime,
        end: datetime,
        marine_source: str,
        variables: tuple[str, ...] = ROUTE_VARIABLES,
    ) -> Callable[[float, float, datetime], dict[str, MarineObservation]]:
        """Grid value lookup: (sample lat, sample lon, hour) -> observations.

        Replay is evaluated lazily (only samples actually visited); live data is
        fetched up-front in batched multi-coordinate requests."""
        if marine_source in ("replay", "historical"):
            offline = self.replay_marine if marine_source == "replay" else self.historical_marine
            return lambda lat, lon, t: offline.values_at(lat, lon, t, variables)  # type: ignore[union-attr]
        by_point = await self.live_marine.observe_many(points, start, end)  # type: ignore[attr-defined]
        states = {p: MarineState(p[0], p[1], obs) for p, obs in by_point.items()}
        empty = MarineState(0, 0, [])
        return lambda lat, lon, t: states.get((lat, lon), empty).values_at(t)

    def health(self) -> list[AdapterHealth]:
        adapters = [self.live_marine, self.replay_marine, *self.live_advisories, *self.replay_advisories]
        if self.historical_marine is not None:
            adapters += [self.historical_marine, *self.historical_advisories]
        return [a.health() for a in adapters]

    @property
    def last_status(self) -> DataStatus | None:
        return self._last_status
