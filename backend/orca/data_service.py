"""Data service: picks adapters by mode and records exactly what was used.

Modes (ORCA_DATA_MODE):
  live   — live adapters only; failures surface as missing data (never faked)
  replay — simulated scenario only (clearly labelled)
  auto   — live first; if the live marine source fails, fall back to the
           simulated scenario and say so in every response (guide §33:
           'fallback demo dataset in case external services fail')

Real official advisories (IMD CAP) are always attempted and always labelled."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime

from pydantic import BaseModel, Field

from .adapters.advisories import AdvisoryAdapter
from .adapters.base import AdapterError, MarineDataAdapter, PointQuery
from .models import AdapterHealth, Advisory, MarineObservation
from .state import MarineState
from .timeutil import Clock

log = logging.getLogger("orca.data")


class DataStatus(BaseModel):
    mode: str
    marine_source: str  # live | replay | none
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
    _last_status: DataStatus | None = field(default=None, init=False)

    async def _marine(self, query: PointQuery) -> tuple[list[MarineObservation], str, str | None]:
        if self.mode == "replay":
            return await self.replay_marine.observe(query), "replay", None
        try:
            return await self.live_marine.observe(query), "live", None
        except AdapterError as exc:
            if self.mode == "live":
                log.warning("live marine source failed: %s", exc)
                return [], "none", str(exc)
            log.warning("live marine source failed, using simulated scenario: %s", exc)
            return await self.replay_marine.observe(query), "replay", str(exc)

    async def advisories(self, marine_source: str) -> tuple[list[Advisory], list[str], list[str]]:
        adapters: list[AdvisoryAdapter] = []
        if self.mode in ("live", "auto"):
            adapters += self.live_advisories
        if marine_source == "replay":
            adapters += self.replay_advisories
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

    async def grid_values(
        self, points: list[tuple[float, float]], start: datetime, end: datetime, marine_source: str
    ) -> dict[tuple[float, float], MarineState]:
        adapter = self.replay_marine if marine_source == "replay" else self.live_marine
        by_point = await adapter.observe_many(points, start, end)  # type: ignore[attr-defined]
        return {p: MarineState(p[0], p[1], obs) for p, obs in by_point.items()}

    def health(self) -> list[AdapterHealth]:
        adapters = [self.live_marine, self.replay_marine, *self.live_advisories, *self.replay_advisories]
        return [a.health() for a in adapters]

    @property
    def last_status(self) -> DataStatus | None:
        return self._last_status
