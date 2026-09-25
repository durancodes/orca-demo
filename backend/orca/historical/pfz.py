"""Candidate fishing zones from real satellite data (historical replay).

Same idea INCOIS uses for its PFZ advisories: fish gather where a sea-surface
temperature front meets water rich in chlorophyll. ORCA reproduces it with public
data only, and says so — these are candidate zones, never INCOIS advisories.

  SST front   : NOAA OISST gradient in the top 10% of the region's sea cells
  Productive  : VIIRS chlorophyll in the top 25% of the region (when available)
  Zone        : connected cells meeting both (fronts alone when no chlorophyll)
  Offshore    : cells within 10 km of land are skipped (turbid coastal water fools the chlorophyll algorithm)

Thresholds are relative (percentiles), so no absolute value is assumed."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union

from ..geo.land import near_land
from ..geo.ports import PORTS
from ..models import DataType
from ..pfz import PFZProvider, PFZZone
from ..timeutil import UTC, ensure_utc

FRONT_PERCENTILE = 90
CHL_PERCENTILE = 75
MAX_ZONES = 8
COAST_EXCLUSION_KM = 10.0
REFERENCE = "docs/DATA_SOURCES.md#fishing-zones-from-satellite-data"


def _gradient_c_per_10km(sst: np.ndarray, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    dy_km = abs(lats[1] - lats[0]) * 111.2
    gy, gx = np.gradient(sst)
    dx_km = np.abs(lons[1] - lons[0]) * 111.2 * np.cos(np.radians(lats))[:, None]
    return np.hypot(gy / dy_km, gx / dx_km) * 10


def _chl_on_grid(chl_lat, chl_lon, chl, lats, lons) -> np.ndarray:
    """Median-free average of log10(chl) inside each SST cell (block aggregation)."""
    out_sum = np.zeros((len(lats), len(lons)))
    out_n = np.zeros((len(lats), len(lons)))
    di = np.clip(np.round((chl_lat - lats[0]) / (lats[1] - lats[0])).astype(int), 0, len(lats) - 1)
    dj = np.clip(np.round((chl_lon - lons[0]) / (lons[1] - lons[0])).astype(int), 0, len(lons) - 1)
    ii, jj = np.meshgrid(di, dj, indexing="ij")
    valid = ~np.isnan(chl)
    np.add.at(out_sum, (ii[valid], jj[valid]), np.log10(chl[valid]))
    np.add.at(out_n, (ii[valid], jj[valid]), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(out_n >= 3, np.power(10.0, out_sum / np.maximum(out_n, 1)), np.nan)


def _components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for i, j in zip(*np.nonzero(mask)):
        if seen[i, j]:
            continue
        stack, comp = [(i, j)], []
        seen[i, j] = True
        while stack:
            a, b = stack.pop()
            comp.append((a, b))
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    x, y = a + da, b + db
                    if 0 <= x < mask.shape[0] and 0 <= y < mask.shape[1] and mask[x, y] and not seen[x, y]:
                        seen[x, y] = True
                        stack.append((x, y))
        comps.append(comp)
    return comps


def _nearest_port_name(lat: float, lon: float) -> str:
    best = min(PORTS, key=lambda p: (p.lat - lat) ** 2 + ((p.lon - lon) * math.cos(math.radians(lat))) ** 2)
    return best.name.split(" (")[0]


def _compass(dlat: float, dlon: float) -> str:
    ang = (math.degrees(math.atan2(dlon, dlat)) + 360) % 360
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int((ang + 22.5) // 45) % 8]


class HistoricalPFZProvider(PFZProvider):
    name = "orca-satellite-pfz"
    mode = "historical"

    def __init__(self, ctx) -> None:  # ReplayContext
        super().__init__()
        self.ctx = ctx
        self._cache: dict[tuple, list[PFZZone]] = {}

    async def zones(self, now: datetime) -> list[PFZZone]:
        return self.compute(ensure_utc(now))

    def compute(self, now: datetime) -> list[PFZZone]:
        arc = self.ctx.archive
        sst_g = arc.sst_grid(now)
        if sst_g is None:
            self._health.status, self._health.last_error = "unavailable", "no SST released yet at this moment"
            return []
        lats, lons, sst, day = sst_g
        chl_g = arc.chl_grid(now)
        key = (arc.event.id, day, bool(chl_g))
        if key in self._cache:
            return self._cache[key]

        grad = _gradient_c_per_10km(sst, lats, lons)
        # offshore sea cells only: satellite chlorophyll is unreliable in turbid near-shore (Case-2) water
        offshore = np.array([[not near_land(float(a), float(b), COAST_EXCLUSION_KM) for b in lons] for a in lats])
        sea = ~np.isnan(grad) & offshore
        front_thr = float(np.nanpercentile(grad[sea], FRONT_PERCENTILE))
        mask = sea & (grad >= front_thr)
        chl = None
        chl_thr = None
        if chl_g is not None:
            chl = _chl_on_grid(chl_g[0], chl_g[1], chl_g[2], lats, lons)
            if np.count_nonzero(~np.isnan(chl)) > 20:
                chl_thr = float(np.nanpercentile(chl, CHL_PERCENTILE))
                mask &= ~np.isnan(chl) & (chl >= chl_thr)
            else:
                chl = None

        step = abs(float(lats[1] - lats[0]))
        zones: list[PFZZone] = []
        comps = sorted(_components(mask), key=lambda c: -sum(grad[i, j] for i, j in c))
        valid_from = datetime(day.year, day.month, day.day, tzinfo=UTC) + timedelta(days=1, hours=12)
        for n, comp in enumerate(comps):
            if len(comp) < 2:
                continue
            shape = unary_union([box(lons[j] - step / 2, lats[i] - step / 2, lons[j] + step / 2, lats[i] + step / 2) for i, j in comp])
            hull = shape.convex_hull.buffer(0.02).simplify(0.02)
            ring = [(round(y, 3), round(x, 3)) for x, y in hull.exterior.coords]
            c = hull.centroid
            port = _nearest_port_name(c.y, c.x)
            p = next(pp for pp in PORTS if pp.name.split(" (")[0] == port)
            side = _compass(c.y - p.lat, c.x - p.lon)
            cells_chl = [float(chl[i, j]) for i, j in comp if chl is not None and not np.isnan(chl[i, j])]
            zones.append(
                PFZZone(
                    id=f"sat-{arc.event.id}-{day:%Y%m%d}-{n}",
                    name=f"{side} of {port} — {'SST front + chlorophyll' if chl is not None else 'SST front'}",
                    source="ORCA from NOAA OISST" + (" + NOAA-20 VIIRS chlorophyll" if chl is not None else ""),
                    data_type=DataType.DERIVED,
                    geometry="polygon",
                    coordinates=ring,
                    centroid=(round(c.y, 3), round(c.x, 3)),
                    valid_from=valid_from,
                    valid_until=valid_from + timedelta(days=3),
                    attributes={
                        "basis": "SST front + chlorophyll" if chl is not None else "SST front only (no chlorophyll archive)",
                        "sst": round(float(np.nanmean([sst[i, j] for i, j in comp])), 2),
                        "sst_front_c_per_10km": round(float(np.nanmax([grad[i, j] for i, j in comp])), 3),
                        "front_threshold_c_per_10km": round(front_thr, 3),
                        "chl": round(float(np.median(cells_chl)), 2) if cells_chl else None,
                        "chl_threshold": round(chl_thr, 2) if chl_thr is not None else None,
                        "cells": len(comp),
                        "sst_day": day.isoformat(),
                        "chl_days": [d.isoformat() for d in chl_g[3]] if chl is not None else [],
                    },
                    reference=REFERENCE,
                    retrieved_at=valid_from,
                )
            )
            if len(zones) >= MAX_ZONES:
                break
        self._health.status, self._health.last_success = "ok", datetime.now(UTC)
        self._cache[key] = zones
        return zones
