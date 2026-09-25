"""Catalogue of historical replay events.

Each event is a real past period for which the archived data was downloaded by
scripts/historical/fetch.py. The summaries state only well-documented facts;
everything ORCA says during a replay comes from the archived data itself."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ..timeutil import IST, UTC


@dataclass(frozen=True)
class HistoricalEvent:
    id: str
    title: str
    kind: str  # cyclone | calm
    summary: str
    region: tuple[float, float, float, float]  # lat_min, lat_max, lon_min, lon_max
    first_cycle: datetime  # first GFS cycle (UTC)
    last_cycle: datetime
    default_as_of: datetime
    place: tuple[float, float, str]
    language_hint: str = "en"
    chl_days: tuple[date, ...] = ()
    sst_first_day: date | None = None
    sst_last_day: date | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def cycles(self) -> list[datetime]:
        out, t = [], self.first_cycle
        while t <= self.last_cycle:
            out.append(t)
            t += timedelta(hours=CYCLE_STEP_H)
        return out

    @property
    def replay_start(self) -> datetime:
        return self.first_cycle + timedelta(hours=6)

    @property
    def replay_end(self) -> datetime:
        return self.last_cycle + timedelta(hours=18)


CYCLE_STEP_H = 12  # 00Z and 12Z GFS runs
LEADS_H = tuple(range(0, 49, 3))  # 0–48 h every 3 h


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def _ist(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=IST)


EVENTS: dict[str, HistoricalEvent] = {
    e.id: e
    for e in [
        HistoricalEvent(
            id="tauktae-2021",
            title="Cyclone Tauktae — Arabian Sea, May 2021",
            kind="cyclone",
            summary="Tauktae formed near Lakshadweep on 14 May 2021, moved north parallel to the Kerala, Karnataka, Goa "
            "and Maharashtra coasts, and crossed the Saurashtra coast of Gujarat on the night of 17 May 2021.",
            region=(5.0, 25.0, 62.0, 80.0),
            first_cycle=_utc("2021-05-12T12:00"),
            last_cycle=_utc("2021-05-18T00:00"),
            default_as_of=_ist("2021-05-14T21:30"),
            place=(15.40, 73.70, "off Mormugao, Goa"),
            sst_first_day=date(2021, 4, 5),
            sst_last_day=date(2021, 5, 18),
            tags=("west coast", "cyclone", "no chlorophyll (VIIRS archive starts 2022)"),
        ),
        HistoricalEvent(
            id="michaung-2023",
            title="Cyclone Michaung — Bay of Bengal, December 2023",
            kind="cyclone",
            summary="Michaung formed over the southwest Bay of Bengal in early December 2023, moved north close to the "
            "Tamil Nadu coast past Chennai, and crossed the Andhra Pradesh coast near Bapatla on 5 December 2023.",
            region=(5.0, 22.0, 77.0, 92.0),
            first_cycle=_utc("2023-12-01T00:00"),
            last_cycle=_utc("2023-12-06T00:00"),
            default_as_of=_ist("2023-12-02T21:30"),
            place=(13.10, 80.45, "off Chennai (Kasimedu)"),
            language_hint="ta",
            chl_days=(date(2023, 11, 27), date(2023, 11, 28), date(2023, 11, 29)),
            sst_first_day=date(2023, 10, 25),
            sst_last_day=date(2023, 12, 6),
            tags=("east coast", "cyclone", "Tamil / Telugu"),
        ),
        HistoricalEvent(
            id="calm-jan-2024",
            title="Fishing-season week — Arabian Sea, January 2024",
            kind="calm",
            summary="A normal winter fishing week on the west coast: settled weather, low waves and clear skies that let "
            "the satellites see chlorophyll fronts.",
            region=(8.0, 22.0, 66.0, 78.0),
            first_cycle=_utc("2024-01-15T00:00"),
            last_cycle=_utc("2024-01-19T00:00"),
            default_as_of=_ist("2024-01-16T21:30"),
            place=(15.40, 73.70, "off Mormugao, Goa"),
            chl_days=(date(2024, 1, 13), date(2024, 1, 14), date(2024, 1, 15)),
            sst_first_day=date(2023, 12, 5),
            sst_last_day=date(2024, 1, 19),
            tags=("west coast", "calm", "fishing zones"),
        ),
    ]
}
DEFAULT_EVENT = "tauktae-2021"
