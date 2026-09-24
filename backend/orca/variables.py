"""Canonical variable names, units and physical plausibility ranges.

Values outside the plausible range are flagged 'suspect' and never reach the
risk engine (guide §30: deterministic validation for units and ranges)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Variable:
    name: str
    unit: str
    label: str
    min_value: float
    max_value: float


VARIABLES: dict[str, Variable] = {
    v.name: v
    for v in [
        Variable("wave_height", "m", "Significant wave height", 0.0, 25.0),
        Variable("swell_wave_height", "m", "Swell wave height", 0.0, 25.0),
        Variable("wave_period", "s", "Wave period", 0.0, 30.0),
        Variable("wind_speed", "km/h", "Wind speed (10 m)", 0.0, 350.0),
        Variable("wind_gusts", "km/h", "Wind gusts (10 m)", 0.0, 450.0),
        Variable("wind_direction", "°", "Wind direction (from)", 0.0, 360.0),
        Variable("weather_code", "WMO code", "Weather (WMO code 4677)", 0.0, 99.0),
        Variable("visibility", "m", "Visibility", 0.0, 200000.0),
        Variable("precipitation", "mm", "Precipitation (hourly)", 0.0, 500.0),
        Variable("cape", "J/kg", "Convective available potential energy", 0.0, 10000.0),
        Variable("sea_surface_temperature", "°C", "Sea surface temperature", -2.5, 40.0),
        Variable("chlorophyll", "mg/m³", "Chlorophyll-a concentration", 0.0, 100.0),
        Variable("current_speed", "km/h", "Ocean current speed", 0.0, 20.0),
        Variable("sea_level", "m", "Sea level incl. tide (model)", -15.0, 15.0),
    ]
}


def validate(variable: str, value: float | None) -> tuple[float | None, str]:
    """Return (value, quality_flag). Unknown variables pass through unchanged."""
    if value is None:
        return None, "missing"
    spec = VARIABLES.get(variable)
    if spec is None:
        return value, "ok"
    if not (spec.min_value <= value <= spec.max_value):
        return None, "suspect"
    return value, "ok"


# WMO weather interpretation codes (WMO code table 4677 as used by Open-Meteo)
THUNDERSTORM_CODES = {95, 96, 99}
WEATHER_CODE_TEXT = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "dense drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    80: "rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "thunderstorm with heavy hail",
}
