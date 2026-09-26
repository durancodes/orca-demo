"""Speech-to-text for the chat microphone.

The browser records the question and uploads it; the server transcribes it in the speaker's own language and
script, so voice works in every browser and the language is detected rather than guessed from a UI setting.

Engines, tried in order until one succeeds:
  gemini   — Gemini (default gemini-2.5-flash, override ORCA_GEMINI_STT_MODEL; key GEMINI_API_KEY). Best on
             Indian languages in ORCA's tests (exact Hindi/Tamil/Malayalam), ~3.5 s.
  whisper  — Whisper on Groq (default whisper-large-v3, override ORCA_WHISPER_MODEL; key GROQ_API_KEY). ~0.8 s,
             but weaker on Dravidian languages (Malayalam came back in Gurmukhi script), so it is the fallback.
The transcript is only ever put in the chat box: the user sees and can correct it before sending."""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from dataclasses import dataclass

import httpx

from .i18n.detect import LANGUAGE_NAMES

log = logging.getLogger("orca.speech")

MAX_AUDIO_BYTES = 8 * 1024 * 1024  # ~4 min of 16 kHz mono WAV; the UI stops recording at 30 s

# Whisper reports language names; ORCA uses ISO 639-1 codes.
WHISPER_LANGUAGES = {
    "english": "en", "hindi": "hi", "tamil": "ta", "telugu": "te", "malayalam": "ml", "kannada": "kn", "bengali": "bn",
    "marathi": "mr", "gujarati": "gu", "punjabi": "pa", "urdu": "ur", "odia": "or", "oriya": "or", "assamese": "as",
}


@dataclass
class Transcript:
    text: str
    language: str | None  # ISO 639-1
    engine: str
    latency_ms: float


class TranscriptionError(Exception):
    pass


class GeminiTranscriber:
    name = "gemini"

    def __init__(self, timeout_s: float = 45.0) -> None:
        self.model = os.getenv("ORCA_GEMINI_STT_MODEL", "gemini-2.5-flash")
        self._client = httpx.AsyncClient(timeout=timeout_s, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})

    async def transcribe(self, audio: bytes, mime: str, hint: str | None) -> tuple[str, str | None]:
        prompt = ("Transcribe this speech exactly, in its original language and native script. Do not translate, "
                  "answer or add anything. If there is no intelligible speech, return empty text.")
        if hint:
            prompt += f" The speaker has chosen {LANGUAGE_NAMES.get(hint, hint)}."
        body = {
            "contents": [{"parts": [{"inlineData": {"mimeType": mime, "data": base64.b64encode(audio).decode()}}, {"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": {"type": "object", "required": ["text", "language"], "properties": {
                    "text": {"type": "string"}, "language": {"type": "string", "description": "ISO 639-1 code of the speech"}}},
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        r = await self._client.post(url, json=body)
        if r.status_code != 200:
            log.warning("gemini transcription error %s: %s", r.status_code, r.text[:500])
            raise TranscriptionError("rate limited" if r.status_code == 429 else f"API error {r.status_code}")
        try:
            data = json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise TranscriptionError(f"unexpected response: {type(exc).__name__}") from exc
        return str(data.get("text", "")).strip(), (str(data.get("language") or "").lower()[:2] or None)


class WhisperTranscriber:
    name = "whisper"

    def __init__(self, timeout_s: float = 45.0) -> None:
        self.model = os.getenv("ORCA_WHISPER_MODEL", "whisper-large-v3")
        self._client = httpx.AsyncClient(timeout=timeout_s, headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"})

    async def transcribe(self, audio: bytes, mime: str, hint: str | None) -> tuple[str, str | None]:
        data = {"model": self.model, "response_format": "verbose_json", **({"language": hint} if hint else {})}
        r = await self._client.post("https://api.groq.com/openai/v1/audio/transcriptions", data=data,
                                    files={"file": ("speech.wav", audio, mime)})
        if r.status_code != 200:
            log.warning("whisper transcription error %s: %s", r.status_code, r.text[:500])
            raise TranscriptionError("rate limited" if r.status_code == 429 else f"API error {r.status_code}")
        j = r.json()
        return j.get("text", "").strip(), WHISPER_LANGUAGES.get(str(j.get("language", "")).lower(), hint)


class Transcriber:
    def __init__(self, engines: list) -> None:
        self.engines = engines

    def describe(self) -> dict:
        return {"available": bool(self.engines), "engines": [f"{e.name}:{e.model}" for e in self.engines]}

    async def transcribe(self, audio: bytes, mime: str, hint: str | None = None) -> Transcript:
        errors = []
        for engine in self.engines:
            started = time.perf_counter()
            try:
                text, language = await engine.transcribe(audio, mime, hint)
            except (TranscriptionError, httpx.HTTPError) as exc:
                errors.append(f"{engine.name}: {exc if isinstance(exc, TranscriptionError) else type(exc).__name__}")
                continue
            return Transcript(text, language, f"{engine.name}:{engine.model}", round((time.perf_counter() - started) * 1000, 1))
        raise TranscriptionError("; ".join(errors) or "no speech engine configured")


def transcriber_from_env() -> Transcriber:
    engines = []
    if os.getenv("GEMINI_API_KEY"):
        engines.append(GeminiTranscriber())
    if os.getenv("GROQ_API_KEY"):
        engines.append(WhisperTranscriber())
    return Transcriber(engines)
