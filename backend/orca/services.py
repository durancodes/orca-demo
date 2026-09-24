"""Service container wiring adapters, engines and stores together.

build_services() reads configuration from the environment:
  ORCA_DATA_MODE   auto | live | replay   (default auto)
  ORCA_LLM_PROVIDER auto | anthropic | none (default auto: anthropic if a key is set)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .adapters.advisories import IMDCapAdapter, ScenarioAdvisoryAdapter
from .adapters.open_meteo import OpenMeteoAdapter
from .adapters.replay import ReplayAdapter
from .agents.context import ContextStore
from .data_service import DataService
from .geo.geofences import GeofenceIndex
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

    @property
    def mode(self) -> str:
        return self.data.mode


def build_services(
    mode: str | None = None,
    llm: LLMProvider | None = None,
    clock: SimClock | None = None,
    live_marine=None,
    live_advisories=None,
    pfz_live: PFZProvider | None = None,
) -> Services:
    mode = (mode or os.getenv("ORCA_DATA_MODE", "auto")).lower()
    if mode not in ("auto", "live", "replay"):
        raise ValueError(f"ORCA_DATA_MODE must be auto, live or replay (got {mode!r})")
    clock = clock or SimClock()
    # The replay scenario is anchored once: its 'day 1' is tomorrow (IST) relative to startup.
    scenario = Scenario(ist_midnight(clock(), 1))
    replay = ReplayAdapter(scenario)
    data = DataService(
        mode=mode,
        live_marine=live_marine or OpenMeteoAdapter(),
        replay_marine=replay,
        live_advisories=live_advisories if live_advisories is not None else [IMDCapAdapter()],
        replay_advisories=[ScenarioAdvisoryAdapter(scenario)],
        clock=clock,
    )
    return Services(
        data=data,
        geofences=GeofenceIndex(),
        pfz_live=pfz_live if pfz_live is not None else (INCOISPFZProvider() if mode != "replay" else None),
        pfz_demo=DemoPFZProvider(scenario),
        clock=clock,
        scenario=scenario,
        llm=llm or provider_from_env(),
    )
