"""MarineDataAdapter interface (guide §9).

Every source gets an adapter with the same shape, so the rest of ORCA never
knows whether a value came from a live API, a replay scenario or a file."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..models import AdapterHealth, MarineObservation
from ..timeutil import UTC


@dataclass(frozen=True)
class PointQuery:
    lat: float
    lon: float
    start: datetime
    end: datetime
    variables: tuple[str, ...] | None = None


@dataclass
class RawPayload:
    adapter: str
    fetched_at: datetime
    request: dict[str, Any]
    payload: Any
    reference: str | None = None


@dataclass
class AdapterError(Exception):
    adapter: str
    message: str

    def __str__(self) -> str:
        return f"{self.adapter}: {self.message}"


@dataclass
class _HealthTracker:
    name: str
    mode: str
    state: AdapterHealth = field(init=False)

    def __post_init__(self) -> None:
        self.state = AdapterHealth(name=self.name, mode=self.mode)

    def success(self, latency_ms: float) -> None:
        self.state.status = "ok"
        self.state.last_success = datetime.now(UTC)
        self.state.last_error = None
        self.state.last_latency_ms = round(latency_ms, 1)

    def failure(self, error: str, latency_ms: float) -> None:
        self.state.status = "unavailable"
        self.state.last_error = error[:300]
        self.state.last_latency_ms = round(latency_ms, 1)


class MarineDataAdapter(ABC):
    name: str = "adapter"
    mode: str = "live"  # live | replay

    def __init__(self) -> None:
        self._health = _HealthTracker(self.name, self.mode)

    @abstractmethod
    def capabilities(self) -> list[str]:
        """Canonical variable names this adapter can supply."""

    @abstractmethod
    async def fetch(self, query: PointQuery) -> RawPayload:
        """Retrieve the raw source payload for a point and time range."""

    @abstractmethod
    def normalize(self, raw: RawPayload) -> list[MarineObservation]:
        """Convert a raw payload into canonical observations."""

    async def observe(self, query: PointQuery) -> list[MarineObservation]:
        started = time.perf_counter()
        try:
            raw = await self.fetch(query)
            observations = self.normalize(raw)
        except AdapterError as exc:
            self._health.failure(str(exc), (time.perf_counter() - started) * 1000)
            raise
        except Exception as exc:  # network, parsing — surfaced as adapter failure
            self._health.failure(f"{type(exc).__name__}: {exc}", (time.perf_counter() - started) * 1000)
            raise AdapterError(self.name, f"{type(exc).__name__}: {exc}") from exc
        self._health.success((time.perf_counter() - started) * 1000)
        return observations

    def health(self) -> AdapterHealth:
        return self._health.state.model_copy()
