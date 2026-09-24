"""LLM provider abstraction (guide §29).

The LLM is only used to (a) understand free-form questions the rule-based intent
parser cannot, and (b) phrase explanations of already-computed results. It never
computes risk. Every provider returns schema-conforming JSON or None; callers
always have a deterministic fallback."""

from __future__ import annotations

import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("orca.llm")


@dataclass
class LLMResult:
    data: dict[str, Any] | None
    provider: str
    model: str | None
    latency_ms: float
    error: str | None = None
    served_by: str | None = None


class LLMProvider(ABC):
    name = "none"
    model: str | None = None

    @property
    def available(self) -> bool:
        return False

    @abstractmethod
    async def complete_json(self, system: str, user: str, schema: dict[str, Any]) -> LLMResult: ...


class NullProvider(LLMProvider):
    name = "none"

    async def complete_json(self, system: str, user: str, schema: dict[str, Any]) -> LLMResult:
        return LLMResult(data=None, provider=self.name, model=None, latency_ms=0.0, error="no LLM configured")


class AnthropicProvider(LLMProvider):
    """Claude via the official Anthropic SDK with structured JSON output.

    Defaults: model claude-opus-5 (override ORCA_ANTHROPIC_MODEL), effort 'low'
    (override ORCA_LLM_EFFORT) because explanations are short, latency-sensitive
    rewrites of structured evidence. Server-side refusal fallbacks are enabled
    ('default' routing) so a classifier decline is retried on Anthropic's
    recommended fallback model instead of failing the explanation."""

    name = "anthropic"

    def __init__(self, model: str | None = None, effort: str | None = None, timeout_s: float = 30.0) -> None:
        import anthropic

        self.model = model or os.getenv("ORCA_ANTHROPIC_MODEL", "claude-opus-5")
        self.effort = effort or os.getenv("ORCA_LLM_EFFORT", "low")
        self._anthropic = anthropic
        self._client = anthropic.AsyncAnthropic(timeout=timeout_s, max_retries=1)

    @property
    def available(self) -> bool:
        return True

    async def complete_json(self, system: str, user: str, schema: dict[str, Any]) -> LLMResult:
        anthropic = self._anthropic
        started = time.perf_counter()
        try:
            response = await self._client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=system,
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.RateLimitError as exc:
            return self._fail(started, f"rate limited: {exc}")
        except anthropic.APIStatusError as exc:
            return self._fail(started, f"API error {exc.status_code}: {exc.message}")
        except anthropic.APIConnectionError as exc:
            return self._fail(started, f"connection error: {exc}")
        latency = (time.perf_counter() - started) * 1000
        if response.stop_reason == "refusal":
            return LLMResult(None, self.name, self.model, latency, error="model declined (refusal)", served_by=response.model)
        if response.stop_reason == "max_tokens":
            return LLMResult(None, self.name, self.model, latency, error="output truncated (max_tokens)", served_by=response.model)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            return LLMResult(None, self.name, self.model, latency, error="no text block in response", served_by=response.model)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            return LLMResult(None, self.name, self.model, latency, error=f"invalid JSON: {exc}", served_by=response.model)
        return LLMResult(data, self.name, self.model, latency, served_by=response.model)

    def _fail(self, started: float, error: str) -> LLMResult:
        log.warning("anthropic provider failed: %s", error)
        return LLMResult(None, self.name, self.model, (time.perf_counter() - started) * 1000, error=error)


@dataclass
class ScriptedProvider(LLMProvider):
    """Deterministic provider for tests: returns queued responses in order."""

    responses: list[dict[str, Any] | None] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)
    name: str = "scripted"
    model: str | None = "scripted-model"

    @property
    def available(self) -> bool:
        return True

    async def complete_json(self, system: str, user: str, schema: dict[str, Any]) -> LLMResult:
        self.calls.append({"system": system, "user": user, "schema": schema})
        data = self.responses.pop(0) if self.responses else None
        return LLMResult(data, self.name, self.model, 1.0, error=None if data is not None else "no scripted response")


def provider_from_env() -> LLMProvider:
    choice = os.getenv("ORCA_LLM_PROVIDER", "auto").lower()
    if choice == "none":
        return NullProvider()
    has_credentials = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    if choice == "anthropic" or (choice == "auto" and has_credentials):
        try:
            return AnthropicProvider()
        except ImportError:
            log.warning("anthropic package not installed; running without LLM (pip install 'orca[llm]')")
    return NullProvider()
