"""Time helpers. Internally everything is timezone-aware UTC; IST is for display
and for interpreting phrases like "tomorrow morning" the way an Indian user means them."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable

UTC = timezone.utc
IST = timezone(timedelta(hours=5, minutes=30), name="IST")

Clock = Callable[[], datetime]


def system_clock() -> datetime:
    return datetime.now(UTC)


class SimClock:
    """System clock with an adjustable offset — lets a demo 'fast-forward' the
    replay scenario to show proactive alerts. Offset is always reported in the UI.

    In historical replay the clock is anchored: 'now' is a fixed past moment
    (plus any fast-forward offset) instead of the wall clock."""

    def __init__(self, base: Clock = system_clock) -> None:
        self._base = base
        self.offset = timedelta(0)
        self.anchor: datetime | None = None

    def __call__(self) -> datetime:
        return (self.anchor if self.anchor is not None else self._base()) + self.offset

    def set_anchor(self, moment: datetime | None) -> None:
        self.anchor = moment.astimezone(UTC) if moment is not None else None
        self.offset = timedelta(0)

    def advance(self, hours: float) -> None:
        self.offset += timedelta(hours=hours)

    def reset(self) -> None:
        self.offset = timedelta(0)


def ensure_utc(dt: datetime) -> datetime:
    """Treat naive datetimes as UTC (Open-Meteo is queried with timezone=GMT)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def ceil_hour(dt: datetime) -> datetime:
    floored = floor_hour(dt)
    return floored if floored == dt else floored + timedelta(hours=1)


def hours_between(start: datetime, end: datetime) -> list[datetime]:
    """Whole hours from start to end inclusive (both floored to the hour)."""
    out: list[datetime] = []
    t = floor_hour(ensure_utc(start))
    end = floor_hour(ensure_utc(end))
    while t <= end:
        out.append(t)
        t += timedelta(hours=1)
    return out


def ist_midnight(dt: datetime, day_offset: int = 0) -> datetime:
    """00:00 IST of the IST calendar day containing dt, shifted by day_offset days; returned in UTC."""
    local = ensure_utc(dt).astimezone(IST)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=day_offset)
    return midnight.astimezone(UTC)


def fmt_ist(dt: datetime) -> str:
    return ensure_utc(dt).astimezone(IST).strftime("%d %b %H:%M IST")


def fmt_ist_hour(dt: datetime) -> str:
    return ensure_utc(dt).astimezone(IST).strftime("%H:%M")
