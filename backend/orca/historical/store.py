"""Compact on-disk format for archived historical data (int16 + per-field scale).

Written by scripts/historical/fetch.py, read by the historical adapter. Missing
values (land in the wave model, no satellite pixel, file not archived) are FILL."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FILL = -32768


@dataclass(frozen=True)
class Field:
    name: str
    grib_var: str
    grib_level: str
    unit: str  # unit of the decoded value
    scale: float  # stored = round((value - offset) * scale)
    offset: float = 0.0
    to_si: float = 1.0  # multiply GRIB value by this before encoding (e.g. kg m-2 s-1 -> mm/h)


ATMOS_FIELDS: tuple[Field, ...] = (
    Field("ugrd10", "UGRD", "10 m above ground", "m/s", 100),
    Field("vgrd10", "VGRD", "10 m above ground", "m/s", 100),
    Field("gust", "GUST", "surface", "m/s", 100),
    Field("vis", "VIS", "surface", "m", 1),
    Field("prmsl", "PRMSL", "mean sea level", "Pa", 1, offset=100000.0),
    Field("prate", "PRATE", "surface", "mm/h", 10, to_si=3600.0),
    Field("cprat", "CPRAT", "surface", "mm/h", 10, to_si=3600.0),
    Field("lftx", "LFTX", "surface", "K", 100),
)
WAVE_FIELDS: tuple[Field, ...] = (
    Field("htsgw", "HTSGW", "surface", "m", 100),
    Field("perpw", "PERPW", "surface", "s", 100),
)
FIELDS = {f.name: f for f in (*ATMOS_FIELDS, *WAVE_FIELDS)}


def encode(values: np.ndarray, f: Field) -> np.ndarray:
    v = (np.asarray(values, dtype=np.float64) * f.to_si - f.offset) * f.scale
    q = np.clip(np.round(v), -32767, 32767)
    return np.where(np.isnan(v), FILL, q).astype(np.int16)


def decode(stored: np.ndarray, f: Field) -> np.ndarray:
    s = np.asarray(stored)
    return np.where(s == FILL, np.nan, s / f.scale + f.offset)
