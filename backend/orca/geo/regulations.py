"""Time-based fishing regulations that are not polygons.

India's uniform annual fishing ban in the EEZ (mechanised/motorised vessels):
  East coast: 15 April – 14 June;  West coast: 1 June – 31 July.
Dates as commonly notified by the Department of Fisheries, GoI; State rules for
territorial waters may differ. Verify against the current year's notification."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from ..timeutil import IST, ensure_utc

BAN_REFERENCE = "Department of Fisheries (GoI) uniform fishing ban period in the Indian EEZ — verify current notification"


class RegulationNotice(BaseModel):
    id: str
    title: str
    in_effect: bool
    period: str
    applies_to: str
    reference: str


def coast_of(lat: float, lon: float) -> str | None:
    if 6.0 <= lat <= 24.5 and 66.0 <= lon <= 77.6 and not (lat < 8.5 and lon > 77.0):
        return "west"
    if 6.0 <= lat <= 23.0 and 77.6 < lon <= 92.5:
        return "east"
    return None


def fishing_ban_notice(lat: float, lon: float, t: datetime) -> RegulationNotice | None:
    coast = coast_of(lat, lon)
    if coast is None:
        return None
    day = ensure_utc(t).astimezone(IST).date()
    if coast == "east":
        start, end, period = date(day.year, 4, 15), date(day.year, 6, 14), "15 Apr – 14 Jun"
    else:
        start, end, period = date(day.year, 6, 1), date(day.year, 7, 31), "1 Jun – 31 Jul"
    return RegulationNotice(
        id=f"fishing-ban-{coast}",
        title=f"Annual fishing ban — {coast} coast",
        in_effect=start <= day <= end,
        period=period,
        applies_to="Mechanised and motorised fishing vessels in the EEZ",
        reference=BAN_REFERENCE,
    )
