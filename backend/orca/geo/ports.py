"""Gazetteer of Indian fishing harbours (approximate harbour positions) with
names in regional scripts, used to resolve places in user queries and as
route start points. Coordinates are approximate and snapped to sea for routing."""

from __future__ import annotations

from pydantic import BaseModel

from .geometry import destination_point, haversine_km
from .land import is_land


class Port(BaseModel):
    id: str
    name: str
    state: str
    lat: float
    lon: float
    aliases: list[str]


PORTS: list[Port] = [
    Port(id="okha", name="Okha", state="Gujarat", lat=22.47, lon=69.07, aliases=["okha", "ઓખા"]),
    Port(id="porbandar", name="Porbandar", state="Gujarat", lat=21.64, lon=69.60, aliases=["porbandar", "પોરબંદર"]),
    Port(id="veraval", name="Veraval", state="Gujarat", lat=20.91, lon=70.37, aliases=["veraval", "વેરાવળ"]),
    Port(id="mumbai", name="Mumbai (Sassoon Dock)", state="Maharashtra", lat=18.91, lon=72.83,
         aliases=["mumbai", "bombay", "sassoon dock", "मुंबई", "मुम्बई"]),
    Port(id="ratnagiri", name="Ratnagiri", state="Maharashtra", lat=16.99, lon=73.27, aliases=["ratnagiri", "रत्नागिरी"]),
    Port(id="malvan", name="Malvan", state="Maharashtra", lat=16.06, lon=73.46, aliases=["malvan", "मालवण"]),
    Port(id="goa", name="Vasco / Mormugao (Goa)", state="Goa", lat=15.41, lon=73.79,
         aliases=["goa", "vasco", "mormugao", "panaji", "गोवा", "गोंय", "ಗೋವಾ"]),
    Port(id="karwar", name="Karwar", state="Karnataka", lat=14.80, lon=74.11, aliases=["karwar", "ಕಾರವಾರ", "कारवार"]),
    Port(id="malpe", name="Malpe (Udupi)", state="Karnataka", lat=13.35, lon=74.70, aliases=["malpe", "udupi", "ಮಲ್ಪೆ", "ಉಡುಪಿ"]),
    Port(id="mangaluru", name="Mangaluru", state="Karnataka", lat=12.87, lon=74.83,
         aliases=["mangaluru", "mangalore", "ಮಂಗಳೂರು", "मंगलुरु"]),
    Port(id="kozhikode", name="Kozhikode (Beypore)", state="Kerala", lat=11.17, lon=75.80,
         aliases=["kozhikode", "calicut", "beypore", "കോഴിക്കോട്"]),
    Port(id="kochi", name="Kochi", state="Kerala", lat=9.97, lon=76.24, aliases=["kochi", "cochin", "കൊച്ചി", "कोच्चि"]),
    Port(id="neendakara", name="Neendakara (Kollam)", state="Kerala", lat=8.94, lon=76.54,
         aliases=["neendakara", "kollam", "quilon", "കൊല്ലം", "നീണ്ടകര"]),
    Port(id="vizhinjam", name="Vizhinjam", state="Kerala", lat=8.38, lon=76.99, aliases=["vizhinjam", "വിഴിഞ്ഞം"]),
    Port(id="kanyakumari", name="Kanyakumari", state="Tamil Nadu", lat=8.08, lon=77.55,
         aliases=["kanyakumari", "கன்னியாகுமரி", "कन्याकुमारी"]),
    Port(id="thoothukudi", name="Thoothukudi", state="Tamil Nadu", lat=8.76, lon=78.19,
         aliases=["thoothukudi", "tuticorin", "தூத்துக்குடி"]),
    Port(id="rameswaram", name="Rameswaram", state="Tamil Nadu", lat=9.29, lon=79.31,
         aliases=["rameswaram", "rameshwaram", "ராமேஸ்வரம்", "ராமேசுவரம்", "रामेश्वरम"]),
    Port(id="nagapattinam", name="Nagapattinam", state="Tamil Nadu", lat=10.77, lon=79.85,
         aliases=["nagapattinam", "நாகப்பட்டினம்"]),
    Port(id="puducherry", name="Puducherry", state="Puducherry", lat=11.93, lon=79.83,
         aliases=["puducherry", "pondicherry", "புதுச்சேரி"]),
    Port(id="chennai", name="Chennai (Kasimedu)", state="Tamil Nadu", lat=13.12, lon=80.30,
         aliases=["chennai", "madras", "kasimedu", "சென்னை", "चेन्नई"]),
    Port(id="kakinada", name="Kakinada", state="Andhra Pradesh", lat=16.94, lon=82.25, aliases=["kakinada", "కాకినాడ"]),
    Port(id="visakhapatnam", name="Visakhapatnam", state="Andhra Pradesh", lat=17.69, lon=83.30,
         aliases=["visakhapatnam", "vizag", "విశాఖపట్నం", "విశాఖ", "विशाखापत्तनम"]),
    Port(id="paradip", name="Paradip", state="Odisha", lat=20.26, lon=86.67, aliases=["paradip", "paradeep", "ପାରାଦୀପ"]),
    Port(id="digha", name="Digha (Shankarpur)", state="West Bengal", lat=21.63, lon=87.51, aliases=["digha", "দিঘা"]),
]


def find_port_in_text(text: str) -> Port | None:
    lowered = text.lower()
    best: tuple[int, Port] | None = None
    for port in PORTS:
        for alias in port.aliases:
            if alias.lower() in lowered and (best is None or len(alias) > best[0]):
                best = (len(alias), port)
    return best[1] if best else None


def nearest_port(lat: float, lon: float) -> tuple[Port, float]:
    port = min(PORTS, key=lambda p: haversine_km(lat, lon, p.lat, p.lon))
    return port, haversine_km(lat, lon, port.lat, port.lon)


def snap_to_sea(lat: float, lon: float, max_km: float = 15.0) -> tuple[float, float]:
    """Nearest sea point (spiral search) so harbour coordinates can start a route."""
    if not is_land(lat, lon):
        return lat, lon
    for radius in (0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15):
        if radius > max_km:
            break
        for bearing in range(0, 360, 15):
            p = destination_point(lat, lon, bearing, radius)
            if not is_land(*p):
                return round(p[0], 4), round(p[1], 4)
    return lat, lon


def is_sea(lat: float, lon: float) -> bool:
    return not is_land(lat, lon)
