"""Observability (guide §17, §32): one trace per request so a judge — or an
engineer — can reconstruct question → plan → tools → evidence → decision."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections import OrderedDict
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from .timeutil import UTC

log = logging.getLogger("orca.trace")


class TraceStep(BaseModel):
    step_id: str
    agent: str
    kind: str  # llm-agent | tool-agent | deterministic-engine
    action: str
    depends_on: list[str] = Field(default_factory=list)
    started_at: datetime
    latency_ms: float | None = None
    ok: bool | None = None
    error: str | None = None
    sources: list[str] = Field(default_factory=list)
    summary: str = ""


class Trace(BaseModel):
    request_id: str
    conversation_id: str
    user_query: str
    language: str | None = None
    intents: list[str] = Field(default_factory=list)
    intent_source: str | None = None
    plan: list[dict[str, Any]] = Field(default_factory=list)
    steps: list[TraceStep] = Field(default_factory=list)
    data_status: dict[str, Any] | None = None
    risk_engine_version: str | None = None
    llm: dict[str, Any] | None = None
    final_decision: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    started_at: datetime
    latency_ms: float | None = None


class TraceRecorder:
    def __init__(self, conversation_id: str, user_query: str) -> None:
        self.trace = Trace(
            request_id=uuid.uuid4().hex[:12],
            conversation_id=conversation_id,
            user_query=user_query,
            started_at=datetime.now(UTC),
        )
        self._t0 = time.perf_counter()
        self._open: dict[str, float] = {}

    def start(self, step_id: str, agent: str, kind: str, action: str, depends_on: list[str] | None = None) -> None:
        self._open[step_id] = time.perf_counter()
        self.trace.steps.append(
            TraceStep(step_id=step_id, agent=agent, kind=kind, action=action, depends_on=depends_on or [], started_at=datetime.now(UTC))
        )

    def finish(self, step_id: str, ok: bool, summary: str = "", sources: list[str] | None = None, error: str | None = None) -> None:
        step = next(s for s in self.trace.steps if s.step_id == step_id)
        step.latency_ms = round((time.perf_counter() - self._open.pop(step_id, time.perf_counter())) * 1000, 1)
        step.ok, step.summary, step.error = ok, summary[:300], error
        step.sources = sources or []
        if error:
            self.trace.errors.append(f"{step_id}: {error}")

    def close(self) -> Trace:
        self.trace.latency_ms = round((time.perf_counter() - self._t0) * 1000, 1)
        log.info(json.dumps(self.trace.model_dump(mode="json"), ensure_ascii=False)[:4000])
        return self.trace


class TraceStore:
    def __init__(self, capacity: int = 200) -> None:
        self._items: OrderedDict[str, Trace] = OrderedDict()
        self._capacity = capacity

    def add(self, trace: Trace) -> None:
        self._items[trace.request_id] = trace
        while len(self._items) > self._capacity:
            self._items.popitem(last=False)

    def get(self, request_id: str) -> Trace | None:
        return self._items.get(request_id)

    def recent(self, n: int = 20) -> list[Trace]:
        return list(self._items.values())[-n:]
