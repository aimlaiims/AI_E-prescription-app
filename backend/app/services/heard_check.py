"""
A check in code that doesn't depend on the model: does a proposed medicine
name sound like anything that was actually said?

Found on real dictations: when Whisper mis-heard a drug ("Cinnarizine" ->
"Tablets and Arisen"), Gemini sometimes put in a DIFFERENT real drug
("Betahistine 25mg") with no sign of doubt — even when told not to. Here every
new medicine line's drug name is compared with the transcript; if nothing said
sounds like it (and no known abbreviation of it was said), the proposal is
marked "check" for the doctor. Measured: substituted names scored 0.40-0.53,
genuine corrections 0.60-1.00 (abbreviations like PCM are covered by aliases).
"""
import re
from difflib import SequenceMatcher

THRESHOLD = 0.6
_FORM = re.compile(r"^(?:tab|tabs|cap|caps|syp|syr|inj|drop|drops|gtt|oint|susp|lot)\.?\s+", re.IGNORECASE)
_NOT_A_NAME = {"nasal", "ear", "eye", "drops", "drop", "spray", "gargles", "gargle", "cream", "ointment",
               "lotion", "tablet", "tablets", "capsule", "syrup", "steam", "warm", "saline"}


def _letters(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _similarity(name: str, heard: str) -> float:
    """Best match of `name` against any 1-4 consecutive heard words, joined
    ("xylo meta zoline" -> "xylometazoline")."""
    target = _letters(name)
    words = re.findall(r"[A-Za-z]+", heard)
    best = 0.0
    for i in range(len(words)):
        for j in range(i + 1, min(i + 4, len(words)) + 1):
            best = max(best, SequenceMatcher(None, target, _letters("".join(words[i:j]))).ratio())
    return best


def _drug_name(line: str) -> str | None:
    rest = _FORM.sub("", line.strip())
    m = re.match(r"[A-Za-z][A-Za-z'-]*", rest)
    if not m:
        return None
    word = m.group(0).strip("-'")
    return None if len(word) < 4 or word.lower() in _NOT_A_NAME else word


def unclear_medicines(new_value: str, old_value: str, transcript: str, terms: list[dict]) -> list[str]:
    """Medicine lines added by this proposal whose name wasn't clearly heard
    (or that the model itself marked "[?]")."""
    old_lines = {l.strip() for l in (old_value or "").splitlines()}
    flagged = []
    for line in (new_value or "").splitlines():
        line = line.strip()
        if not line or line in old_lines:
            continue
        if "[?]" in line:
            flagged.append(line)
            continue
        name = _drug_name(line)
        if not name or _similarity(name, transcript) >= THRESHOLD:
            continue
        # Said by a known abbreviation? ("PCM", "Amoxyclav")
        aliases = [a for t in terms if t["name"].lower().startswith(name.lower()) for a in t["aliases"]]
        if any(_similarity(a, transcript) >= 0.8 for a in aliases):
            continue
        flagged.append(name)
    return flagged


def check_note(flagged: list[str]) -> str:
    if not flagged:
        return ""
    names = [f for f in flagged if "[?]" not in f]
    if names:
        return f"Check the medicine: “{', '.join(names)}” wasn't clearly heard."
    return "A medicine name wasn't clear. Check it."
