"""Marine State (guide §5 'Normalize into Marine State').

Combines normalized observations from any adapters for one location into an
hour-indexed view, plus the advisories that actually contain the point."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from .geo.geometry import point_in_polygon
from .models import Advisory, DataType, Evidence, MarineObservation
from .timeutil import ensure_utc, floor_hour


def advisories_at_point(lat: float, lon: float, t: datetime, advisories: list[Advisory]) -> list[Advisory]:
    """Advisories whose area contains the point and whose validity covers time t."""
    t = ensure_utc(t)
    out = []
    for adv in advisories:
        if adv.onset and t < adv.onset:
            continue
        if adv.expires and t >= adv.expires:
            continue
        if any(point_in_polygon(lat, lon, poly) for poly in adv.polygons):
            out.append(adv)
    return out


class MarineState:
    def __init__(
        self,
        lat: float,
        lon: float,
        observations: list[MarineObservation],
        advisories: list[Advisory] | None = None,
    ) -> None:
        self.lat = lat
        self.lon = lon
        self.observations = observations
        self.advisories = advisories or []
        self._by_hour: dict[datetime, dict[str, MarineObservation]] = defaultdict(dict)
        for obs in observations:
            slot = self._by_hour[floor_hour(obs.valid_time)]
            current = slot.get(obs.variable)
            # first usable value wins; a usable value replaces a missing/suspect one
            if current is None or (current.value is None and obs.value is not None):
                slot[obs.variable] = obs

    def times(self) -> list[datetime]:
        return sorted(self._by_hour)

    def values_at(self, t: datetime) -> dict[str, MarineObservation]:
        return dict(self._by_hour.get(floor_hour(ensure_utc(t)), {}))

    def value(self, t: datetime, variable: str) -> float | None:
        obs = self.values_at(t).get(variable)
        return None if obs is None else obs.value

    def series(self, variable: str) -> list[tuple[datetime, float | None]]:
        return [(t, (self._by_hour[t].get(variable).value if variable in self._by_hour[t] else None)) for t in self.times()]

    def advisories_at(self, t: datetime) -> list[Advisory]:
        """Advisories whose area contains this point and whose validity covers time t."""
        return advisories_at_point(self.lat, self.lon, t, self.advisories)

    def advisories_containing_point(self) -> list[Advisory]:
        return [a for a in self.advisories if any(point_in_polygon(self.lat, self.lon, p) for p in a.polygons)]

    def data_types(self) -> set[DataType]:
        return {o.data_type for o in self.observations} | {a.data_type for a in self.advisories}

    def is_simulated(self) -> bool:
        return DataType.SIMULATED in self.data_types()

    def evidence_index(self) -> dict[str, Evidence]:
        idx = {o.id: o.to_evidence() for o in self.observations}
        idx.update({a.id: a.to_evidence() for a in self.advisories})
        return idx

    def sources(self) -> list[dict]:
        seen: dict[tuple[str, str], dict] = {}
        for o in self.observations:
            key = (o.source, o.source_product)
            entry = seen.setdefault(
                key,
                {
                    "source": o.source,
                    "product": o.source_product,
                    "data_type": o.data_type.value,
                    "retrieved_at": o.retrieved_at,
                    "reference": o.reference,
                    "variables": set(),
                },
            )
            entry["variables"].add(o.variable)
            entry["retrieved_at"] = min(entry["retrieved_at"], o.retrieved_at)
        out = []
        for entry in seen.values():
            entry["variables"] = sorted(entry["variables"])
            out.append(entry)
        return out
