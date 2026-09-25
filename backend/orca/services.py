"""Service container wiring adapters, engines and stores together.

build_services() reads configuration from the environment:
  ORCA_DATA_MODE     historical | auto | live | replay
                     (default historical when the archive is present, else auto)
  ORCA_REPLAY_EVENT  historical event id (default tauktae-2021; see orca/historical/events.py)
  ORCA_LLM_PROVIDER auto | anthropic | none (default auto: anthropic if a key is set)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .adapters.advisories import IMDCapAdapter, ScenarioAdvisoryAdapter
from .adapters.historical import CycloneWatchAdapter, HistoricalCAPAdapter, HistoricalMarineAdapter, ReplayContext
from .adapters.open_meteo import OpenMeteoAdapter
from .adapters.replay import ReplayAdapter
from .agents.context import ContextStore
from .data_service import DataService
from .geo.geofences import GeofenceIndex
from .historical.archive import EventArchive
from .historical.events import DEFAULT_EVENT, EVENTS
from .historical.pfz import HistoricalPFZProvider
from .llm.providers import LLMProvider, provider_from_env
from .pfz import DemoPFZProvider, INCOISPFZProvider, PFZProvider
from .scenario import Scenario
from .timeutil import SimClock, ist_midnight
from .trace import TraceStore


@dataclass
class Services:
    data: DataService
    geofences: GeofenceIndex
    pfz_live: PFZProvider | None
    pfz_demo: PFZProvider
    clock: SimClock
    scenario: Scenario
    llm: LLMProvider
    contexts: ContextStore = field(default_factory=ContextStore)
    traces: TraceStore = field(default_factory=TraceStore)
    alerts: object | None = None  # AlertEngine, attached by the app
    replay: ReplayContext | None = None  # historical mode only
    pfz_historical: PFZProvider | None = None

    @property
    def mode(self) -> str:
        return self.data.mode

    @property
    def offline_source(self) -> str | None:
        """The non-live marine source this process serves from, if any."""
        return {"replay": "replay", "historical": "historical"}.get(self.mode)

    def current_source(self) -> str:
        """Source for requests that do not fetch marine data themselves (map layers, alerts, advisories)."""
        if self.offline_source:
            return self.offline_source
        last = self.data.last_status
        return "replay" if last and last.marine_source == "replay" else "live"

    def set_event(self, event_id: str, as_of=None) -> None:
        """Historical mode: load another archived event and move the replay clock to it."""
        if self.replay is None:
            raise ValueError("not in historical mode")
        event = EVENTS[event_id]
        self.replay.set_event(event)
        self.clock.set_anchor(as_of or event.default_as_of)


def build_services(
    mode: str | None = None,
    llm: LLMProvider | None = None,
    clock: SimClock | None = None,
    live_marine=None,
    live_advisories=None,
    pfz_live: PFZProvider | None = None,
    event_id: str | None = None,
) -> Services:
    event = EVENTS[event_id or os.getenv("ORCA_REPLAY_EVENT", DEFAULT_EVENT)]
    default_mode = "historical" if EventArchive(event).available else "auto"
    mode = (mode or os.getenv("ORCA_DATA_MODE", default_mode)).lower()
    if mode not in ("historical", "auto", "live", "replay"):
        raise ValueError(f"ORCA_DATA_MODE must be historical, auto, live or replay (got {mode!r})")
    clock = clock or SimClock()
    # The replay scenario is anchored once: its 'day 1' is tomorrow (IST) relative to startup.
    scenario = Scenario(ist_midnight(clock(), 1))
    replay = ReplayAdapter(scenario)
    ctx = None
    if mode == "historical":
        ctx = ReplayContext(event, clock)
        if not ctx.archive.available:
            raise ValueError(f"no archived data for {event.id}: run python scripts/historical/fetch.py {event.id}")
        clock.set_anchor(event.default_as_of)
    data = DataService(
        mode=mode,
        live_marine=live_marine or OpenMeteoAdapter(),
        replay_marine=replay,
        live_advisories=live_advisories if live_advisories is not None else [IMDCapAdapter()],
        replay_advisories=[ScenarioAdvisoryAdapter(scenario)],
        clock=clock,
        historical_marine=HistoricalMarineAdapter(ctx) if ctx else None,
        historical_advisories=[HistoricalCAPAdapter(ctx), CycloneWatchAdapter(ctx)] if ctx else [],
    )
    return Services(
        data=data,
        geofences=GeofenceIndex(),
        pfz_live=pfz_live if pfz_live is not None else (INCOISPFZProvider() if mode in ("live", "auto") else None),
        pfz_demo=DemoPFZProvider(scenario),
        clock=clock,
        scenario=scenario,
        llm=llm or provider_from_env(),
        replay=ctx,
        pfz_historical=HistoricalPFZProvider(ctx) if ctx else None,
    )
