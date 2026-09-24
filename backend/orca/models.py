"""Common Marine Data Model (guide §10) plus the decision/evidence types that
flow between agents. Agents only ever see these types, never source formats."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class DataType(str, Enum):
    OBSERVATION = "observation"
    FORECAST = "forecast"
    HISTORICAL = "historical"
    DERIVED = "derived"
    SIMULATED = "simulated"
    OFFICIAL_ADVISORY = "official_advisory"


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Evidence(BaseModel):
    """One traceable fact: what, where, when, from which source, how processed."""

    id: str
    source: str
    product: str
    data_type: DataType
    variable: str | None = None
    value: float | str | None = None
    unit: str | None = None
    lat: float | None = None
    lon: float | None = None
    valid_time: datetime | None = None
    retrieved_at: datetime
    reference: str | None = None
    processing: str | None = None


class MarineObservation(BaseModel):
    """A single normalized value at a point and valid time (guide §10)."""

    id: str
    source: str
    source_product: str
    lat: float
    lon: float
    retrieved_at: datetime
    valid_time: datetime
    data_type: DataType
    variable: str
    value: float | None
    unit: str
    quality_flag: str = "ok"  # ok | missing | suspect
    spatial_resolution: str | None = None
    processing_version: str
    reference: str | None = None

    @property
    def provenance_id(self) -> str:
        return self.id

    def to_evidence(self) -> Evidence:
        return Evidence(
            id=self.id,
            source=self.source,
            product=self.source_product,
            data_type=self.data_type,
            variable=self.variable,
            value=self.value,
            unit=self.unit,
            lat=self.lat,
            lon=self.lon,
            valid_time=self.valid_time,
            retrieved_at=self.retrieved_at,
            reference=self.reference,
            processing=f"normalized by {self.processing_version}; quality={self.quality_flag}",
        )


class Advisory(BaseModel):
    """An official (or clearly-labelled simulated) warning with its area and validity."""

    id: str
    source: str
    data_type: DataType
    event: str
    headline: str
    description: str = ""
    severity: str  # CAP severity: Extreme | Severe | Moderate | Minor | Unknown
    urgency: str = "Unknown"
    certainty: str = "Unknown"
    onset: datetime | None = None
    expires: datetime | None = None
    sent: datetime | None = None
    area_desc: str = ""
    polygons: list[list[tuple[float, float]]] = Field(default_factory=list)  # [(lat, lon), ...]
    reference: str | None = None
    retrieved_at: datetime

    def to_evidence(self) -> Evidence:
        return Evidence(
            id=self.id,
            source=self.source,
            product=f"{self.event} ({self.severity})",
            data_type=self.data_type,
            variable="advisory",
            value=self.headline,
            valid_time=self.onset,
            retrieved_at=self.retrieved_at,
            reference=self.reference,
            processing=f"area: {self.area_desc}; valid {self.onset} to {self.expires}",
        )


class AdapterHealth(BaseModel):
    name: str
    mode: str  # live | replay
    status: str = "unknown"  # ok | degraded | unavailable | unknown
    last_success: datetime | None = None
    last_error: str | None = None
    last_latency_ms: float | None = None


def model_dump_jsonable(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    if isinstance(obj, list):
        return [model_dump_jsonable(o) for o in obj]
    if isinstance(obj, dict):
        return {k: model_dump_jsonable(v) for k, v in obj.items()}
    return obj
