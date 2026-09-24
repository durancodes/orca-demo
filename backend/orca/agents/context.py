"""Structured conversation state (guide §23).

Stores resolved facts, not raw chat: location, time window, selected zone,
language, vessel speed. Rules:
  • an explicit new location/time in the message always wins over context;
  • "is it safe (there)?" after a PFZ answer refers to that zone;
  • state expires after inactivity."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pydantic import BaseModel

from ..timeutil import UTC

SESSION_TTL = timedelta(hours=6)
MAX_SESSIONS = 2000


class Place(BaseModel):
    lat: float
    lon: float
    label: str
    source: str  # coordinates | port | pfz | device | context


class SelectedZone(BaseModel):
    id: str
    name: str
    lat: float
    lon: float


class ConversationState(BaseModel):
    session_id: str
    language: str = "en"
    location: Place | None = None
    window: tuple[datetime, datetime] | None = None
    selected_zone: SelectedZone | None = None
    last_intents: list[str] = []
    speed_knots: float = 8.0
    turns: int = 0
    updated_at: datetime


@dataclass
class ContextStore:
    _sessions: dict[str, ConversationState] = field(default_factory=dict)

    def get(self, session_id: str | None, now: datetime) -> ConversationState:
        self._expire(now)
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        sid = session_id or uuid.uuid4().hex[:16]
        state = ConversationState(session_id=sid, updated_at=now)
        self._sessions[sid] = state
        return state

    def save(self, state: ConversationState, now: datetime) -> None:
        state.updated_at = now
        state.turns += 1
        self._sessions[state.session_id] = state

    def _expire(self, now: datetime) -> None:
        stale = [k for k, v in self._sessions.items() if now - v.updated_at > SESSION_TTL]
        for k in stale:
            del self._sessions[k]
        if len(self._sessions) > MAX_SESSIONS:
            for k in sorted(self._sessions, key=lambda k: self._sessions[k].updated_at)[: len(self._sessions) - MAX_SESSIONS]:
                del self._sessions[k]


def now_utc() -> datetime:
    return datetime.now(UTC)
