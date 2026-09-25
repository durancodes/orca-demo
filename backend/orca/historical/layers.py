"""Gridded map layers from the archive (wind vectors, waves, SST, chlorophyll) and the replay timeline."""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from ..adapters.historical import HistoricalCAPAdapter, cyclone_track, find_cyclone
from ..geo.land import is_land
from ..timeutil import ensure_utc, floor_hour
from .archive import EventArchive


def _grid(lat: np.ndarray, lon: np.ndarray, values: dict[str, np.ndarray], decimals: int = 2, stride: int = 1) -> dict:
    lat, lon = lat[::stride], lon[::stride]
    out = {
        "lat0": round(float(lat[0]), 4),
        "lon0": round(float(lon[0]), 4),
        "dlat": round(float(lat[1] - lat[0]), 4),
        "dlon": round(float(lon[1] - lon[0]), 4),
        "nlat": len(lat),
        "nlon": len(lon),
    }
    for name, arr in values.items():
        a = np.round(arr[::stride, ::stride].astype(float), decimals)
        out[name] = [None if np.isnan(v) else float(v) for v in a.ravel()]
    return out


def field_layers(archive: EventArchive, valid: datetime, as_of: datetime, which: set[str]) -> dict:
    valid, as_of = ensure_utc(valid), ensure_utc(as_of)
    out: dict = {"valid": valid.isoformat(), "as_of": as_of.isoformat()}
    if "wind" in which:
        u = archive.atmos.grid("ugrd10", valid, as_of)
        v = archive.atmos.grid("vgrd10", valid, as_of)
        if u is not None and v is not None:
            out["wind"] = _grid(archive.atmos.lat, archive.atmos.lon, {"u": u[0], "v": v[0]}) | {
                "run": u[1].isoformat(), "lead_h": u[2], "unit": "m/s", "source": "NOAA GFS 0.5°"}
    if "waves" in which:
        hs = archive.wave.grid("htsgw", valid, as_of)
        if hs is not None:
            out["waves"] = _grid(archive.wave.lat, archive.wave.lon, {"hs": hs[0]}) | {
                "run": hs[1].isoformat(), "lead_h": hs[2], "unit": "m", "source": "NOAA GFS-Wave 0.25°"}
    if "sst" in which:
        s = archive.sst_grid(as_of)
        if s is not None:
            out["sst"] = _grid(s[0], s[1], {"sst": s[2]}) | {"day": s[3].isoformat(), "unit": "°C", "source": "NOAA OISST v2.1"}
    if "chl" in which:
        c = archive.chl_grid(as_of)
        if c is not None:
            stride = max(1, int(np.ceil(max(len(c[0]), len(c[1])) / 180)))
            land = np.array([[is_land(float(a), float(b)) for b in c[1]] for a in c[0]])
            chl = np.where(land, np.nan, c[2])
            out["chl"] = _grid(c[0], c[1], {"chl": chl}, decimals=3, stride=stride) | {
                "days": [d.isoformat() for d in c[3]], "unit": "mg/m³", "source": "NOAA-20 VIIRS (NOAA STAR)"}
    return out


def replay_timeline(archive: EventArchive, cap: HistoricalCAPAdapter, as_of: datetime) -> dict:
    """What was known at as_of: the cyclone's past positions (each run's analysis), the latest run's
    forecast track, and every IMD warning already sent."""
    as_of = ensure_utc(as_of)
    past = []
    for c, p in zip(archive.atmos.cycles, archive.atmos.published):
        if p <= as_of:
            found = find_cyclone(archive, c, as_of)
            if found:
                past.append(found)
    forecast = cyclone_track(archive, as_of, hours=48, step=6)
    warnings = [
        {"id": a.id, "sent": a.sent, "event": a.event, "headline": a.headline, "severity": a.severity, "area": a.area_desc,
         "onset": a.onset, "expires": a.expires, "description": a.description[:600], "reference": a.reference}
        for a in cap.all_alerts() if (a.sent or a.onset) and (a.sent or a.onset) <= as_of
    ]
    ev = archive.event
    runs = [{"cycle": c.isoformat(), "published": p.isoformat(), "known": p <= as_of}
            for c, p in zip(archive.atmos.cycles, archive.atmos.published)]
    return {
        "event": ev.id,
        "as_of": as_of.isoformat(),
        "start": floor_hour(ev.replay_start).isoformat(),
        "end": floor_hour(ev.replay_end).isoformat(),
        "runs": runs,
        "track_observed": [_track_point(c) for c in past],
        "track_forecast": [_track_point(c) for c in forecast],
        "warnings": sorted(warnings, key=lambda w: w["sent"] or w["onset"], reverse=True),
    }


def _track_point(c: dict) -> dict:
    return {"lat": c["lat"], "lon": c["lon"], "valid": c["valid"].isoformat(), "max_wind_kmh": c["max_wind_kmh"],
            "pressure_hpa": c["pressure_hpa"], "category": c["category"], "run": c["cycle"].isoformat(), "lead_h": c["lead_h"]}


def replay_window(archive: EventArchive) -> tuple[datetime, datetime]:
    ev = archive.event
    return ev.replay_start, ev.replay_end - timedelta(hours=1)
