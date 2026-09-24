"""Language identification from Unicode script (guide §24).

Script ranges are unambiguous for most Indian languages; Devanagari is split
between Hindi and Marathi using common Marathi function words, and Latin-script
text with several romanized-Hindi markers is treated as Hindi."""

from __future__ import annotations

import re

SCRIPTS: list[tuple[str, int, int]] = [
    ("deva", 0x0900, 0x097F),
    ("beng", 0x0980, 0x09FF),
    ("guru", 0x0A00, 0x0A7F),
    ("gujr", 0x0A80, 0x0AFF),
    ("orya", 0x0B00, 0x0B7F),
    ("taml", 0x0B80, 0x0BFF),
    ("telu", 0x0C00, 0x0C7F),
    ("knda", 0x0C80, 0x0CFF),
    ("mlym", 0x0D00, 0x0D7F),
]
SCRIPT_LANG = {"beng": "bn", "guru": "pa", "gujr": "gu", "orya": "or", "taml": "ta", "telu": "te", "knda": "kn", "mlym": "ml"}

LANGUAGE_NAMES = {
    "en": "English",
    "hi": "हिन्दी (Hindi)",
    "mr": "मराठी (Marathi)",
    "ta": "தமிழ் (Tamil)",
    "te": "తెలుగు (Telugu)",
    "ml": "മലയാളം (Malayalam)",
    "kn": "ಕನ್ನಡ (Kannada)",
    "gu": "ગુજરાતી (Gujarati)",
    "bn": "বাংলা (Bengali)",
    "or": "ଓଡ଼ିଆ (Odia)",
    "pa": "ਪੰਜਾਬੀ (Punjabi)",
}

MARATHI_MARKERS = ("आहे", "नाही", "उद्या", "काय", "सकाळी", "मासेमारी", "जाऊ", "आहेत", "का?", "करू")
HINGLISH_MARKERS = (
    "kya", "hai", "kal", "aaj", "samundar", "samudra", "machli", "machhli", "surakshit", "jana", "jaana",
    "mausam", "subah", "sham", "toofan", "tufaan", "barish", "kahan", "kitna", "nahi", "mein", "pe ",
)


def _script_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for name, lo, hi in SCRIPTS:
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    return counts


def detect_language(text: str) -> str:
    counts = _script_counts(text)
    if counts:
        script = max(counts, key=counts.get)
        if script == "deva":
            return "mr" if any(m in text for m in MARATHI_MARKERS) else "hi"
        return SCRIPT_LANG[script]
    lowered = f" {text.lower()} "
    hits = sum(1 for m in HINGLISH_MARKERS if re.search(rf"\b{re.escape(m.strip())}\b", lowered))
    return "hi" if hits >= 2 else "en"


NATIVE_DIGITS = {
    "०१२३४५६७८९": "0123456789",  # Devanagari
    "০১২৩৪৫৬৭৮৯": "0123456789",  # Bengali
    "૦૧૨૩૪૫૬૭૮૯": "0123456789",  # Gujarati
    "୦୧୨୩୪୫୬୭୮୯": "0123456789",  # Odia
    "௦௧௨௩௪௫௬௭௮௯": "0123456789",  # Tamil
    "౦౧౨౩౪౫౬౭౮౯": "0123456789",  # Telugu
    "೦೧೨೩೪೫೬೭೮೯": "0123456789",  # Kannada
    "൦൧൨൩൪൫൬൭൮൯": "0123456789",  # Malayalam
}
_DIGIT_TABLE = str.maketrans({n: a for natives, ascii_ in NATIVE_DIGITS.items() for n, a in zip(natives, ascii_)})


def normalize_digits(text: str) -> str:
    """Convert native-script digits to ASCII so coordinates/times parse in any script."""
    return text.translate(_DIGIT_TABLE)
