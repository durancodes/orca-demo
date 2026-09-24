"""Intent Agent (guide §16): language, intent(s) and entities from a user message.

Rule-based first (deterministic, testable, works offline in 10+ languages);
the LLM is consulted only when no rule matches. The Intent Agent never decides
safety — it only says what the user is asking about, where and when."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..geo.ports import Port, find_port_in_text
from ..i18n.detect import detect_language, normalize_digits
from ..llm.providers import LLMProvider
from ..timeutil import IST, UTC, ensure_utc

INTENTS = ("safety", "pfz", "conditions", "alerts", "hotspots", "route", "productivity", "avoid", "help")

# Priority when several intents match (earlier = primary).
PRIORITY = ("productivity", "route", "avoid", "hotspots", "pfz", "alerts", "safety", "conditions", "help")

KEYWORDS: dict[str, tuple[str, ...]] = {
    "safety": (
        "safe", "safety", "venture", "risk", "risky", "dangerous", "danger", "go out", "go fishing", "go to sea",
        "should i go", "can i go", "सुरक्षित", "सुरक्षा", "खतरा", "खतरनाक", "जाना", "जा सकत", "जाएँ", "जाऊँ",
        "धोका", "जाऊ", "surakshit", "khatra", "ja sakte", "jaana", "பாதுகாப்பு", "பாதுகாப்பான", "ஆபத்து",
        "செல்லலாமா", "போகலாமா", "செல்லலாம்", "போகலாம்", "సురక్షిత", "ప్రమాదం", "వెళ్ళవచ్చా", "వెళ్లవచ్చా",
        "వెళ్లొచ్చా", "സുരക്ഷിത", "അപകട", "പോകാമോ", "ಸುರಕ್ಷಿತ", "ಅಪಾಯ", "ಹೋಗಬಹುದೇ", "સુરક્ષિત", "જોખમ",
        "নিরাপদ", "বিপদ", "ସୁରକ୍ଷିତ", "ବିପଦ",
    ),
    "pfz": (
        "pfz", "potential fishing", "fishing zone", "fishing ground", "fishing area", "where to fish",
        "where can i fish", "where should i fish", "find fish", "place to fish", "fish near",
        "मत्स्य क्षेत्र", "मछली क्षेत्र", "मछली कहाँ", "मछली कहां", "मछली पकड़ने का क्षेत्र", "machli kahan",
        "machhli kahan", "मासेमारी क्षेत्र", "मासे कुठे", "மீன்பிடி மண்டலம்", "மீன்பிடி பகுதி", "மீன் எங்கே",
        "மீன் கிடைக்கும்", "చేపల వేట ప్రాంతం", "చేపలు ఎక్కడ", "చేపలు దొరికే", "മത്സ്യബന്ധന മേഖല",
        "മീൻ എവിടെ", "മീൻ കിട്ടുന്ന", "ಮೀನುಗಾರಿಕೆ ವಲಯ", "ಮೀನು ಎಲ್ಲಿ", "માછીમારી ક્ષેત્ર", "માછલી ક્યાં",
        "মাছ ধরার এলাকা", "মাছ কোথায়", "ମାଛ ଧରିବା ଅଞ୍ଚଳ", "ମାଛ କେଉଁଠି",
    ),
    "conditions": (
        "tide", "weather", "sea condition", "sea state", "conditions", "wave", "wind", "forecast",
        "sea temperature", "ज्वार", "मौसम", "लहर", "हवा", "समुद्र की स्थिति", "mausam", "lehar", "भरती", "हवामान",
        "लाटा", "ஓதம்", "வானிலை", "அலை", "காற்று", "கடல் நிலை", "పోటు", "వాతావరణం", "అలలు", "గాలి",
        "సముద్ర పరిస్థితి", "വേലിയേറ്റം", "കാലാവസ്ഥ", "തിരമാല", "കാറ്റ്", "ಉಬ್ಬರ", "ಹವಾಮಾನ", "ಅಲೆ",
        "ભરતી", "હવામાન", "জোয়ার", "আবহাওয়া", "ଜୁଆର", "ପାଣିପାଗ",
    ),
    "alerts": (
        "alert", "warning", "cyclone", "lightning", "storm", "thunder", "advisory", "depression",
        "चेतावनी", "चक्रवात", "तूफान", "तूफ़ान", "बिजली", "आँधी", "toofan", "tufaan", "chakravat", "इशारा",
        "चक्रीवादळ", "वीज", "எச்சரிக்கை", "புயல்", "மின்னல்", "இடி", "హెచ్చరిక", "తుఫాను", "పిడుగు",
        "ఉరుము", "മുന്നറിയിപ്പ്", "ചുഴലിക്കാറ്റ്", "ഇടിമിന്നൽ", "ಎಚ್ಚರಿಕೆ", "ಚಂಡಮಾರುತ", "ಸಿಡಿಲು",
        "ચેતવણી", "વાવાઝોડું", "সতর্কতা", "ঘূর্ণিঝড়", "বজ্রপাত", "ସତର୍କତା", "ବାତ୍ୟା", "ବଜ୍ରପାତ",
    ),
    "hotspots": (
        "chlorophyll", "sea surface temperature", "sst", "productive water", "hotspot", "favourable",
        "favorable", "क्लोरोफिल", "குளோரோபில்", "క్లోరోఫిల్", "ക്ലോറോഫിൽ", "ಕ್ಲೋರೋಫಿಲ್",
    ),
    "route": (
        "route", "path", "navigate", "navigation", "way to", "how to reach", "course to", "रास्ता", "मार्ग",
        "rasta", "வழி", "பாதை", "మార్గం", "దారి", "വഴി", "പാത", "ಮಾರ್ಗ", "માર્ગ", "পথ", "ମାର୍ଗ",
    ),
    "productivity": (
        "productivity", "declin", "less fish", "fewer fish", "low catch", "catch dropped", "reduced catch",
        "catch has", "मछली कम", "कम मछली", "पकड़ कम", "उत्पादकता", "मासे कमी", "மீன் குறைவு",
        "மீன்வளம் குறைந்தது", "பிடிப்பு குறைந்தது", "చేపలు తగ్గ", "మత్స్య సంపద తగ్గ", "മീൻ കുറഞ്ഞ",
    ),
    "avoid": (
        "avoid", "should be avoided", "hazardous zone", "restricted", "geofence", "border", "boundary",
        "imbl", "protected area", "sanctuary", "बचें", "बचना", "सीमा", "प्रतिबंधित", "தவிர்க்க", "எல்லை",
        "தடை", "నివారించ", "సరిహద్దు", "నిషేధ", "ഒഴിവാക്ക", "അതിർത്തി", "നിരോധിത",
    ),
    "help": (
        "hello", "help", "what can you do", "नमस्ते", "मदद", "வணக்கம்", "உதவி", "నమస్తే", "సహాయం",
        "നമസ്കാരം", "സഹായം",
    ),
}
# Words that only count as a whole word (avoid 'hi' in 'this', 'path' in 'sympathy').
WHOLE_WORD = {"sst", "pfz", "imbl", "path", "wind", "wave", "help", "hello", "safe", "tide", "storm", "risk"}

DAY_WORDS: list[tuple[int, tuple[str, ...]]] = [
    (2, ("day after tomorrow", "परसों", "parson", "நாளை மறுநாள்", "ఎల్లుండి", "മറ്റന്നാൾ", "ನಾಡಿದ್ದು", "પરમદિવસે", "পরশু", "ପଅରଦିନ")),
    (1, ("tomorrow", "कल", "kal", "उद्या", "நாளை", "రేపు", "നാളെ", "ನಾಳೆ", "કાલે", "আগামীকাল", "কাল", "କାଲି")),
    (0, ("today", "tonight", "आज", "aaj", "இன்று", "ఈరోజు", "ఇవాళ", "ഇന്ന്", "ಇಂದು", "આજે", "আজ", "ଆଜି")),
]
PART_WORDS: list[tuple[tuple[int, int], tuple[str, ...]]] = [
    ((5, 11), ("morning", "dawn", "सुबह", "subah", "सकाळी", "காலை", "ఉదయం", "രാവിലെ", "ಬೆಳಿಗ್ಗೆ", "સવારે", "সকাল", "ସକାଳ")),
    ((12, 16), ("afternoon", "noon", "दोपहर", "दुपारी", "மதியம்", "మధ్యాహ్నం", "ഉച്ച", "ಮಧ್ಯಾಹ್ನ", "બપોરે", "দুপুর", "ମଧ୍ୟାହ୍ନ")),
    ((16, 20), ("evening", "शाम", "sham", "संध्याकाळी", "மாலை", "సాయంత్రం", "വൈകുന്നേരം", "ಸಂಜೆ", "સાંજે", "সন্ধ্যা", "ସନ୍ଧ୍ୟା")),
    ((20, 29), ("night", "tonight", "रात", "रात्री", "இரவு", "రాత్రి", "രാത്രി", "ರಾತ್ರಿ", "રાત્રે", "রাত", "ରାତି")),
]
NOW_WORDS = ("now", "right now", "currently", "अभी", "abhi", "आत्ता", "இப்போது", "ఇప్పుడు", "ഇപ്പോൾ", "ಈಗ", "હમણાં", "এখন", "ବର୍ତ୍ତମାନ")
REFERENCE_WORDS = (
    " it", "there", "that zone", "that pfz", "that place", "same place", "वहाँ", "वहां", "उधर", "तिथे",
    "அங்கு", "அங்கே", "அது", "அந்த", "అక్కడ", "ఆ ప్రాంతం", "അവിടെ", "ಅಲ್ಲಿ", "ત્યાં", "সেখানে", "ସେଠାରେ",
)

COORD_RE = re.compile(
    r"(-?\d{1,2}\.\d+)\s*°?\s*([NnSs])?\s*[,/ ]\s*(-?\d{1,3}\.\d+)\s*°?\s*([EeWw])?"
)
CLOCK_RE = re.compile(
    r"(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|बजे|baje|மணிக்கு|மணி|గంటలకు|മണിക്ക്|ಗಂಟೆಗೆ|વાગ્યે|টায়|ଟାରେ)",
    re.IGNORECASE,
)
DURATION_RE = re.compile(r"(\d{1,2})\s*(hours|hour|hrs|hr|h\b|घंटे|घंटा|மணி நேர|గంటల|മണിക്കൂർ|ತಾಸು|કલાક|ঘণ্টা|ଘଣ୍ଟା)", re.IGNORECASE)
SPEED_RE = re.compile(r"(\d{1,2}(?:\.\d+)?)\s*(knots|knot|kn|kts)\b", re.IGNORECASE)


@dataclass
class TimeSpec:
    day_offset: int | None = None
    part: tuple[int, int] | None = None
    clock: tuple[int, int] | None = None
    duration_h: float | None = None
    now: bool = False

    @property
    def explicit(self) -> bool:
        return any(v is not None for v in (self.day_offset, self.part, self.clock, self.duration_h)) or self.now


@dataclass
class ParsedMessage:
    text: str
    language: str
    intents: list[str]
    coordinates: tuple[float, float] | None = None
    port: Port | None = None
    time: TimeSpec = field(default_factory=TimeSpec)
    refers_to_previous: bool = False
    speed_knots: float | None = None
    source: str = "rules"  # rules | llm | none

    @property
    def primary_intent(self) -> str | None:
        return self.intents[0] if self.intents else None


def _contains(text: str, keyword: str) -> bool:
    if keyword in WHOLE_WORD:
        return re.search(rf"\b{re.escape(keyword)}\b", text) is not None
    return keyword in text


def match_intents(text: str) -> list[str]:
    lowered = text.lower()
    found = sorted(
        (intent for intent, words in KEYWORDS.items() if any(_contains(lowered, w.lower()) for w in words)),
        key=PRIORITY.index,
    )
    # "route considering sea-state conditions" / "zones to avoid due to hazardous conditions":
    # 'conditions' qualifies the main request rather than asking for a conditions report.
    if found and found[0] in ("route", "avoid", "hotspots", "productivity") and "conditions" in found:
        found.remove("conditions")
    if len(found) > 1 and "help" in found:
        found.remove("help")
    return found


def _parse_coordinates(text: str) -> tuple[float, float] | None:
    m = COORD_RE.search(text)
    if not m:
        return None
    lat, ns, lon, ew = float(m.group(1)), m.group(2), float(m.group(3)), m.group(4)
    if ns and ns.upper() == "S":
        lat = -abs(lat)
    if ew and ew.upper() == "W":
        lon = -abs(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def _has_word(text: str, word: str) -> bool:
    """Whole-word match for Latin-script words; substring match for Indic scripts
    (which attach case suffixes to words, e.g. நாளைக்கு, കാലത്ത്)."""
    if word.isascii():
        return re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", text) is not None
    return word in text


def _parse_time(text: str) -> TimeSpec:
    lowered = text.lower()
    spec = TimeSpec()
    for offset, words in DAY_WORDS:
        if any(_has_word(lowered, w) for w in words):
            spec.day_offset = offset
            break
    for part, words in PART_WORDS:
        if any(_has_word(lowered, w) for w in words):
            spec.part = part
            break
    for m in CLOCK_RE.finditer(lowered):
        hour, minute, suffix = int(m.group(1)), int(m.group(2) or 0), m.group(3).lower()
        if hour > 23 or minute > 59:
            continue
        if suffix.startswith("p") and hour < 12:
            hour += 12
        elif suffix.startswith("a") and hour == 12:
            hour = 0
        elif not suffix.startswith(("a", "p")) and spec.part and spec.part[0] >= 12 and hour < 12:
            hour += 12  # "शाम 6 बजे" -> 18:00
        spec.clock = (hour, minute)
        break
    if (m := DURATION_RE.search(lowered)) is not None:
        spec.duration_h = float(m.group(1))
    spec.now = any(_has_word(lowered, w) for w in NOW_WORDS)
    return spec


def _refers_to_previous(lowered: str) -> bool:
    for w in REFERENCE_WORDS:
        w = w.strip()
        if w == "there":
            # existential "there is/are/any" is not a place reference
            if re.search(r"(?<![a-z])there(?![a-z])(?!\s+(is|are|any|was|were|will)\b)", lowered):
                return True
        elif _has_word(lowered, w):
            return True
    return False


def parse_message(text: str) -> ParsedMessage:
    normalized = normalize_digits(text)
    language = detect_language(text)
    speed = None
    if (m := SPEED_RE.search(normalized)) is not None:
        speed = float(m.group(1))
    lowered = f" {normalized.lower()} "
    return ParsedMessage(
        text=text,
        language=language,
        intents=match_intents(normalized),
        coordinates=_parse_coordinates(normalized),
        port=find_port_in_text(normalized),
        time=_parse_time(normalized),
        refers_to_previous=_refers_to_previous(lowered),
        speed_knots=speed,
    )


def resolve_window(spec: TimeSpec, now: datetime, default_hours: float = 6.0) -> tuple[datetime, datetime]:
    """Turn a TimeSpec into a concrete [start, end] window in UTC, interpreting words in IST."""
    now = ensure_utc(now)
    local_now = now.astimezone(IST)
    duration = timedelta(hours=spec.duration_h or default_hours)
    day = spec.day_offset

    def at(day_offset: int, hour: int, minute: int = 0) -> datetime:
        base = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=day_offset)
        return (base + timedelta(hours=hour, minutes=minute)).astimezone(UTC)

    if spec.clock:
        h, m = spec.clock
        start = at(day if day is not None else 0, h, m)
        if day is None and start < now:
            start += timedelta(days=1)
        return start, start + duration
    if spec.part:
        p_start, p_end = spec.part
        d = day if day is not None else 0
        start, end = at(d, p_start), at(d, p_end)
        if day is None and end <= now:
            start, end = start + timedelta(days=1), end + timedelta(days=1)
        if spec.duration_h:
            end = start + duration
        return max(start, now) if d == 0 else start, end
    if day is not None and day > 0:
        start = at(day, 5)
        return start, start + (duration if spec.duration_h else timedelta(hours=12))
    return now, now + duration


LLM_INTENT_SCHEMA = {
    "type": "object",
    "properties": {
        "intents": {"type": "array", "items": {"type": "string", "enum": list(INTENTS)}},
        "place_name": {"type": ["string", "null"]},
        "latitude": {"type": ["number", "null"]},
        "longitude": {"type": ["number", "null"]},
        "day_offset": {"type": ["integer", "null"]},
        "start_hour_local": {"type": ["integer", "null"]},
        "duration_hours": {"type": ["number", "null"]},
    },
    "required": ["intents", "place_name", "latitude", "longitude", "day_offset", "start_hour_local", "duration_hours"],
    "additionalProperties": False,
}
LLM_INTENT_SYSTEM = (
    "You classify questions sent to ORCA, a marine decision-support assistant for Indian fishermen. "
    "Return only the intents that apply, chosen from the schema enum: safety (is it safe to go to sea), pfz "
    "(potential fishing zones), conditions (tide/weather/sea state), alerts (warnings, cyclone, lightning), hotspots "
    "(chlorophyll / sea-surface-temperature areas), route (navigation between places), productivity (why catches "
    "changed), avoid (zones to avoid, boundaries, restricted areas), help. Extract a place name, coordinates, day "
    "offset (0 today, 1 tomorrow) and local start hour only if the user stated them; otherwise null. Never guess."
)


async def llm_parse(parsed: ParsedMessage, provider: LLMProvider) -> ParsedMessage:
    """Fallback when rules found no intent. Output is validated before use."""
    if not provider.available:
        return parsed
    result = await provider.complete_json(LLM_INTENT_SYSTEM, parsed.text, LLM_INTENT_SCHEMA)
    data = result.data
    if not data:
        return parsed
    intents = [i for i in data.get("intents", []) if i in INTENTS]
    if not intents:
        return parsed
    parsed.intents = sorted(set(intents), key=PRIORITY.index)
    parsed.source = "llm"
    lat, lon = data.get("latitude"), data.get("longitude")
    if parsed.coordinates is None and isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            parsed.coordinates = (float(lat), float(lon))
    if parsed.port is None and data.get("place_name"):
        parsed.port = find_port_in_text(str(data["place_name"]))
    if parsed.time.day_offset is None and isinstance(data.get("day_offset"), int) and 0 <= data["day_offset"] <= 7:
        parsed.time.day_offset = data["day_offset"]
    hour = data.get("start_hour_local")
    if parsed.time.clock is None and isinstance(hour, int) and 0 <= hour <= 23:
        parsed.time.clock = (hour, 0)
    dur = data.get("duration_hours")
    if parsed.time.duration_h is None and isinstance(dur, (int, float)) and 0 < dur <= 72:
        parsed.time.duration_h = float(dur)
    return parsed
