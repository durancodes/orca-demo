"""Fast scalar land/sea lookup on the global-land-mask 1 km GLOBE mask.

The package's is_land() converts every scalar through numpy (~100 µs/call);
route planning needs tens of thousands of lookups, so this reuses its mask with
plain-Python index arithmetic (~1 µs/call). Same data, same indexing rule."""

from __future__ import annotations

from global_land_mask import globe

_OCEAN = globe._mask  # True where ocean
_LAT0 = float(globe._lat[0])
_DLAT = float(globe._lat[1] - globe._lat[0])
_LON0 = float(globe._lon[0])
_DLON = float(globe._lon[1] - globe._lon[0])
_LAT_MIN, _LAT_MAX = float(globe._lat.min()), float(globe._lat.max())
_LON_MIN, _LON_MAX = float(globe._lon.min()), float(globe._lon.max())


def is_land(lat: float, lon: float) -> bool:
    lat = min(max(lat, _LAT_MIN), _LAT_MAX)
    lon = min(max(lon, _LON_MIN), _LON_MAX)
    return not bool(_OCEAN[int((lat - _LAT0) / _DLAT), int((lon - _LON0) / _DLON)])


def is_sea(lat: float, lon: float) -> bool:
    return not is_land(lat, lon)


def near_land(lat: float, lon: float, km: float = 10.0) -> bool:
    """True if land lies within about `km` (checked on two rings of 12 bearings)."""
    import math

    if is_land(lat, lon):
        return True
    for r in (km / 2, km):
        dlat = r / 111.2
        dlon = r / (111.2 * max(0.2, math.cos(math.radians(lat))))
        for k in range(12):
            a = math.radians(k * 30)
            if is_land(lat + dlat * math.cos(a), lon + dlon * math.sin(a)):
                return True
    return False
