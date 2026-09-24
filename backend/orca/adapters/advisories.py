"""Advisory adapters: official warnings with geometry.

IMDCapAdapter reads IMD's public CAP (Common Alerting Protocol) feed, mirrored by
the WMO Alert Hub at cap-sources.s3.amazonaws.com (licence: public domain). Each
alert carries severity, validity window and area polygons, so ORCA can decide by
point-in-polygon whether a location is actually inside an official warning."""

from __future__ import annotations

import asyncio
import math
import time
import xml.etree.ElementTree as ET
from abc import ABC, abstractmethod
from datetime import datetime

import httpx

from ..models import AdapterHealth, Advisory, DataType
from ..scenario import Scenario
from ..timeutil import UTC, ensure_utc
from .base import AdapterError

IMD_CAP_RSS = "https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml"
CAP_NS = {"cap": "urn:oasis:names:tc:emergency:cap:1.2"}


class AdvisoryAdapter(ABC):
    name = "advisories"
    mode = "live"

    def __init__(self) -> None:
        self._health = AdapterHealth(name=self.name, mode=self.mode)

    @abstractmethod
    async def fetch_advisories(self, now: datetime) -> list[Advisory]:
        """All advisories currently in effect (or issued and not yet expired)."""

    def health(self) -> AdapterHealth:
        return self._health.model_copy()

    def _ok(self, started: float) -> None:
        self._health.status = "ok"
        self._health.last_success = datetime.now(UTC)
        self._health.last_error = None
        self._health.last_latency_ms = round((time.perf_counter() - started) * 1000, 1)

    def _fail(self, started: float, err: str) -> None:
        self._health.status = "unavailable"
        self._health.last_error = err[:300]
        self._health.last_latency_ms = round((time.perf_counter() - started) * 1000, 1)


class IMDCapAdapter(AdvisoryAdapter):
    name = "imd-cap"
    mode = "live"

    def __init__(self, client: httpx.AsyncClient | None = None, timeout_s: float = 12.0, cache_ttl_s: float = 600) -> None:
        super().__init__()
        self._client = client
        self._timeout = timeout_s
        self._cache_ttl = cache_ttl_s
        self._cap_cache: dict[str, Advisory | None] = {}
        self._last: tuple[float, list[Advisory]] | None = None

    async def fetch_advisories(self, now: datetime) -> list[Advisory]:
        if self._last and time.monotonic() - self._last[0] < self._cache_ttl:
            return _active(self._last[1], now)
        started = time.perf_counter()
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            rss = await client.get(IMD_CAP_RSS)
            if rss.status_code != 200:
                raise AdapterError(self.name, f"HTTP {rss.status_code} for RSS")
            links = parse_rss_links(rss.text)
            missing = [link for link in links if link not in self._cap_cache]

            async def load(link: str) -> None:
                resp = await client.get(link)
                self._cap_cache[link] = parse_cap(resp.text, link, datetime.now(UTC)) if resp.status_code == 200 else None

            await asyncio.gather(*(load(link) for link in missing))
            advisories = [a for link in links if (a := self._cap_cache.get(link)) is not None]
        except Exception as exc:
            self._fail(started, f"{type(exc).__name__}: {exc}")
            raise AdapterError(self.name, f"{type(exc).__name__}: {exc}") from exc
        finally:
            if self._client is None:
                await client.aclose()
        self._ok(started)
        self._last = (time.monotonic(), advisories)
        return _active(advisories, now)


class ScenarioAdvisoryAdapter(AdvisoryAdapter):
    name = "scenario-advisories"
    mode = "replay"

    def __init__(self, scenario: Scenario) -> None:
        super().__init__()
        self.scenario = scenario

    async def fetch_advisories(self, now: datetime) -> list[Advisory]:
        started = time.perf_counter()
        out = _active(self.scenario.advisories(now), now)
        self._ok(started)
        return out


def _active(advisories: list[Advisory], now: datetime) -> list[Advisory]:
    now = ensure_utc(now)
    return [a for a in advisories if a.expires is None or a.expires > now]


def parse_rss_links(text: str) -> list[str]:
    root = ET.fromstring(text)
    links = []
    for item in root.iter("item"):
        link = item.findtext("link")
        if link and link.endswith(".xml"):
            links.append(link.strip())
    return links


def _parse_dt(text: str | None) -> datetime | None:
    if not text:
        return None
    return ensure_utc(datetime.fromisoformat(text.strip()))


def _parse_polygon(text: str) -> list[tuple[float, float]]:
    pts = []
    for pair in text.split():
        lat_s, lon_s = pair.split(",")[:2]
        pts.append((float(lat_s), float(lon_s)))
    return pts


def _circle_polygon(text: str, n: int = 24) -> list[tuple[float, float]]:
    centre, radius_km = text.split()
    lat, lon = (float(v) for v in centre.split(","))
    r_deg = float(radius_km) / 111.0
    return [
        (lat + r_deg * math.sin(2 * math.pi * i / n), lon + r_deg * math.cos(2 * math.pi * i / n) / math.cos(math.radians(lat)))
        for i in range(n + 1)
    ]


def parse_cap(xml_text: str, reference: str, retrieved_at: datetime) -> Advisory | None:
    """Parse a CAP 1.2 alert. Returns None for non-actual or cancelled messages."""
    root = ET.fromstring(xml_text)
    status = root.findtext("cap:status", namespaces=CAP_NS)
    msg_type = root.findtext("cap:msgType", namespaces=CAP_NS)
    if status != "Actual" or msg_type == "Cancel":
        return None
    info = root.find("cap:info", CAP_NS)
    if info is None:
        return None
    polygons: list[list[tuple[float, float]]] = []
    area_descs = []
    for area in info.findall("cap:area", CAP_NS):
        area_descs.append(area.findtext("cap:areaDesc", default="", namespaces=CAP_NS))
        for poly in area.findall("cap:polygon", CAP_NS):
            if poly.text:
                polygons.append(_parse_polygon(poly.text))
        for circle in area.findall("cap:circle", CAP_NS):
            if circle.text:
                polygons.append(_circle_polygon(circle.text))
    get = lambda tag: (info.findtext(f"cap:{tag}", default="", namespaces=CAP_NS) or "").strip()  # noqa: E731
    return Advisory(
        id=f"imd-cap:{root.findtext('cap:identifier', namespaces=CAP_NS)}",
        source=f"India Meteorological Department — {get('senderName') or 'IMD'} (CAP feed)",
        data_type=DataType.OFFICIAL_ADVISORY,
        event=get("event"),
        headline=get("headline"),
        description=get("description"),
        severity=get("severity") or "Unknown",
        urgency=get("urgency") or "Unknown",
        certainty=get("certainty") or "Unknown",
        onset=_parse_dt(get("onset") or get("effective")),
        expires=_parse_dt(get("expires")),
        sent=_parse_dt(root.findtext("cap:sent", namespaces=CAP_NS)),
        area_desc="; ".join(d for d in area_descs if d),
        polygons=polygons,
        reference=reference,
        retrieved_at=retrieved_at,
    )
