"""Read access to one event's archived data, with the no-look-ahead rule built in.

For any 'as of' moment ORCA may only use what had been published by then:
  - GFS / GFS-Wave: the latest run whose files were on NOAA's server (S3 upload
    time) at the as-of moment. Past hours come from the run that covered them.
  - OISST: the latest day released by then (one-day release lag).
  - Chlorophyll: the multi-day composite, once its last day has passed.
  - IMD CAP warnings: only those already sent.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import cached_property
from pathlib import Path

import numpy as np

from ..timeutil import UTC, ensure_utc
from .events import HistoricalEvent
from .store import FIELDS, decode

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "historical"
PUBLISH_FALLBACK_H = 4.0  # if the upload time is unknown, assume a run is out 4 h after its start
MAX_LEAD_H = 48
SST_RELEASE_LAG = timedelta(days=1, hours=12)


@dataclass(frozen=True)
class Sample:
    value: float | None
    cycle: datetime
    lead_h: float
    published: datetime
    grid_lat: float
    grid_lon: float


class GridStack:
    """GFS fields for all runs: arrays [run, lead, lat, lon]."""

    def __init__(self, path: Path) -> None:
        self.npz = np.load(path)
        self.lat = self.npz["lat"].astype(float)
        self.lon = self.npz["lon"].astype(float)
        self.cycles = [datetime.fromisoformat(str(c)) for c in self.npz["cycles"]]
        self.published = [
            datetime.fromisoformat(str(p)) if str(p) else c + timedelta(hours=PUBLISH_FALLBACK_H)
            for p, c in zip(self.npz["published"], self.cycles)
        ]
        self.leads = [int(h) for h in self.npz["leads"]]
        self.step = self.leads[1] - self.leads[0]
        self._fields: dict[str, np.ndarray] = {}
        self._nearest_valid: np.ndarray | None = None

    def field(self, name: str) -> np.ndarray:
        if name not in self._fields:
            self._fields[name] = decode(self.npz[name], FIELDS[name]).astype(np.float32)
        return self._fields[name]

    def has(self, name: str) -> bool:
        return name in self.npz.files

    def run_for(self, as_of: datetime, valid: datetime) -> int | None:
        """Latest run published by as_of that starts at or before the valid time."""
        best = None
        for i, (c, p) in enumerate(zip(self.cycles, self.published)):
            if p <= as_of and c <= valid:
                best = i
        return best

    def index(self, lat: float, lon: float, sea_field: str | None = None) -> tuple[int, int]:
        i = int(np.clip(round((lat - self.lat[0]) / (self.lat[1] - self.lat[0])), 0, len(self.lat) - 1))
        j = int(np.clip(round((lon - self.lon[0]) / (self.lon[1] - self.lon[0])), 0, len(self.lon) - 1))
        if sea_field is None:
            return i, j
        nv = self.nearest_valid(sea_field)
        return int(nv[i, j, 0]), int(nv[i, j, 1])

    def nearest_valid(self, name: str) -> np.ndarray:
        """For every cell, the nearest cell with data (wave models have no values over land/coast)."""
        if self._nearest_valid is None:
            valid = ~np.isnan(self.field(name)[0, 0])
            vi, vj = np.nonzero(valid)
            out = np.zeros(valid.shape + (2,), dtype=np.int32)
            for i in range(valid.shape[0]):
                for j in range(valid.shape[1]):
                    if valid[i, j]:
                        out[i, j] = (i, j)
                    else:
                        k = int(np.argmin((vi - i) ** 2 + (vj - j) ** 2))
                        out[i, j] = (vi[k], vj[k])
            self._nearest_valid = out
        return self._nearest_valid

    def sample(self, name: str, lat: float, lon: float, valid: datetime, as_of: datetime, sea: bool = False) -> Sample | None:
        run = self.run_for(as_of, valid)
        if run is None:
            return None
        lead = (valid - self.cycles[run]).total_seconds() / 3600
        if lead > MAX_LEAD_H:
            return None
        i, j = self.index(lat, lon, name if sea else None)
        k = min(int(lead // self.step), len(self.leads) - 2)
        w = (lead - self.leads[k]) / self.step
        arr = self.field(name)
        a, b = arr[run, k, i, j], arr[run, k + 1, i, j]
        if np.isnan(a) and np.isnan(b):
            value = None
        elif np.isnan(a) or np.isnan(b):
            value = float(b if np.isnan(a) else a)
        else:
            value = float((1 - w) * a + w * b)
        return Sample(value, self.cycles[run], lead, self.published[run], float(self.lat[i]), float(self.lon[j]))

    def grid(self, name: str, valid: datetime, as_of: datetime) -> tuple[np.ndarray, datetime, float] | None:
        """Whole-region field at one valid time (for map layers and cyclone tracking)."""
        run = self.run_for(as_of, valid)
        if run is None:
            return None
        lead = (valid - self.cycles[run]).total_seconds() / 3600
        if lead > MAX_LEAD_H:
            return None
        k = min(int(lead // self.step), len(self.leads) - 2)
        w = (lead - self.leads[k]) / self.step
        arr = self.field(name)
        g = (1 - w) * arr[run, k] + w * arr[run, k + 1]
        return g, self.cycles[run], lead


class EventArchive:
    def __init__(self, event: HistoricalEvent, root: Path = DATA_DIR) -> None:
        self.event = event
        self.dir = root / event.id

    @property
    def available(self) -> bool:
        return (self.dir / "gfs_wave.npz").exists() and (self.dir / "gfs_atmos.npz").exists()

    @cached_property
    def wave(self) -> GridStack:
        return GridStack(self.dir / "gfs_wave.npz")

    @cached_property
    def atmos(self) -> GridStack:
        return GridStack(self.dir / "gfs_atmos.npz")

    @cached_property
    def meta(self) -> dict:
        p = self.dir / "meta.json"
        return json.loads(p.read_text()) if p.exists() else {}

    # ---- sea-surface temperature (NOAA OISST v2.1)
    @cached_property
    def _sst(self) -> dict | None:
        p = self.dir / "sst.npz"
        if not p.exists():
            return None
        z = np.load(p)
        return {
            "lat": z["lat"].astype(float),
            "lon": z["lon"].astype(float),
            "days": [date.fromisoformat(str(d)) for d in z["days"]],
            "sst": np.where(z["sst"] == -32768, np.nan, z["sst"] / 100.0),
            "anom": np.where(z["anom"] == -32768, np.nan, z["anom"] / 100.0),
        }

    def sst_day_index(self, as_of: datetime) -> int | None:
        s = self._sst
        if s is None:
            return None
        released = [i for i, d in enumerate(s["days"]) if datetime(d.year, d.month, d.day, tzinfo=UTC) + SST_RELEASE_LAG <= as_of]
        return released[-1] if released else None

    def sst_at(self, lat: float, lon: float, as_of: datetime) -> tuple[float | None, float | None, date] | None:
        s, k = self._sst, self.sst_day_index(as_of)
        if s is None or k is None:
            return None
        i, j = self._nearest_sea(s["sst"][k], s["lat"], s["lon"], lat, lon)
        if i is None:
            return None
        v, a = s["sst"][k, i, j], s["anom"][k, i, j]
        return (None if np.isnan(v) else float(v)), (None if np.isnan(a) else float(a)), s["days"][k]

    def sst_series(self, lat: float, lon: float, as_of: datetime) -> list[tuple[date, float, float]]:
        s, k = self._sst, self.sst_day_index(as_of)
        if s is None or k is None:
            return []
        i, j = self._nearest_sea(s["sst"][k], s["lat"], s["lon"], lat, lon)
        if i is None:
            return []
        return [
            (s["days"][d], float(s["sst"][d, i, j]), float(s["anom"][d, i, j]))
            for d in range(k + 1)
            if not np.isnan(s["sst"][d, i, j])
        ]

    def sst_grid(self, as_of: datetime) -> tuple[np.ndarray, np.ndarray, np.ndarray, date] | None:
        s, k = self._sst, self.sst_day_index(as_of)
        if s is None or k is None:
            return None
        return s["lat"], s["lon"], s["sst"][k], s["days"][k]

    # ---- chlorophyll-a composite (NOAA-20 VIIRS)
    @cached_property
    def _chl(self) -> dict | None:
        p = self.dir / "chl.npz"
        if not p.exists():
            return None
        z = np.load(p)
        log = np.where(z["log10_chl"] == -32768, np.nan, z["log10_chl"] / 1000.0)
        return {
            "lat": z["lat"].astype(float),
            "lon": z["lon"].astype(float),
            "chl": np.power(10.0, log),
            "days": [date.fromisoformat(str(d)) for d in z["days"]],
        }

    def chl_available(self, as_of: datetime) -> bool:
        c = self._chl
        if c is None:
            return False
        last = c["days"][-1]
        return datetime(last.year, last.month, last.day, tzinfo=UTC) + timedelta(days=1) <= as_of

    def chl_at(self, lat: float, lon: float, as_of: datetime, radius_cells: int = 2) -> float | None:
        from ..geo.land import is_land

        if not self.chl_available(as_of) or is_land(lat, lon):  # inland lakes and reservoirs also show chlorophyll
            return None
        c = self._chl
        i = int(np.clip(round((lat - c["lat"][0]) / (c["lat"][1] - c["lat"][0])), 0, len(c["lat"]) - 1))
        j = int(np.clip(round((lon - c["lon"][0]) / (c["lon"][1] - c["lon"][0])), 0, len(c["lon"]) - 1))
        win = c["chl"][max(0, i - radius_cells) : i + radius_cells + 1, max(0, j - radius_cells) : j + radius_cells + 1]
        if np.all(np.isnan(win)):
            return None
        return float(np.nanmedian(win))

    def chl_grid(self, as_of: datetime) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[date]] | None:
        if not self.chl_available(as_of):
            return None
        c = self._chl
        return c["lat"], c["lon"], c["chl"], c["days"]

    @staticmethod
    def _nearest_sea(field: np.ndarray, lats: np.ndarray, lons: np.ndarray, lat: float, lon: float) -> tuple[int | None, int | None]:
        i, j = int(np.argmin(np.abs(lats - lat))), int(np.argmin(np.abs(lons - lon)))
        for r in range(0, 5):
            win = field[max(0, i - r) : i + r + 1, max(0, j - r) : j + r + 1]
            if np.any(~np.isnan(win)):
                ii, jj = np.nonzero(~np.isnan(win))
                d = (ii + max(0, i - r) - i) ** 2 + (jj + max(0, j - r) - j) ** 2
                k = int(np.argmin(d))
                return int(ii[k] + max(0, i - r)), int(jj[k] + max(0, j - r))
        return None, None


def wind_from_uv(u: float, v: float) -> tuple[float, float]:
    """(speed km/h, direction the wind blows FROM in degrees)."""
    speed = math.hypot(u, v) * 3.6
    direction = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    return speed, direction


def as_utc(dt: datetime) -> datetime:
    return ensure_utc(dt)
