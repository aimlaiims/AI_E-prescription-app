"""
A department's common terms (backend/app/vocabulary/<CODE>.json): typing
suggestions in the app and preferred spellings for dictation. The file is the
only place to change them (read once per server start).
"""
import json
import logging
from functools import lru_cache
from itertools import zip_longest
from pathlib import Path

logger = logging.getLogger(__name__)

FOLDER = Path(__file__).resolve().parents[1] / "vocabulary"
LISTS = ("diagnoses", "medications")
# Which list helps which field. Whole-visit dictation gets both.
FOR_FIELD = {"diagnosis": ("diagnoses",), "medications": ("medications",)}


def terms_code(department_code: str | None) -> str | None:
    """The demo department (services/demo.py) uses ENT's lists."""
    return "ENT" if department_code and department_code.upper() == "DEMO" else department_code


@lru_cache(maxsize=None)
def load(department_code: str | None) -> dict:
    empty = {name: [] for name in LISTS}
    if not department_code:
        return empty
    department_code = terms_code(department_code)
    path = FOLDER / f"{department_code.upper()}.json"
    if not path.is_file():
        return empty
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        logger.error("Vocabulary %s couldn't be read (%s); continuing without it.", path.name, e)
        return empty
    return {
        name: [
            {"name": t["name"], "group": t.get("group", ""), "aliases": list(t.get("aliases", []))}
            for t in data.get(name, [])
            if isinstance(t, dict) and t.get("name")
        ]
        for name in LISTS
    }


WHISPER_WORDS_MAX_CHARS = 600  # Whisper reads only ~224 tokens of prompt
WHISPER_TAIL = "mg, tablet, syrup, drops, twice daily, thrice daily, at bedtime."


def _hard_words(terms: list[dict], skip: set) -> list[str]:
    """Words Whisper is likely to misspell: long words of the names (8+
    letters) and upper-case abbreviations, each once."""
    words = []
    for t in terms:
        parts = [w.strip("(),.±") for w in t["name"].replace("–", " ").replace("-", " ").split()]
        for w in [w for w in parts if len(w) >= 8] + [a for a in t["aliases"] if a.isupper()]:
            if w and w.lower() not in skip:
                skip.add(w.lower())
                words.append(w)
    return words


@lru_cache(maxsize=None)
def whisper_hint(department_code: str | None, field: str | None) -> str | None:
    """The speech-to-text hint for a recording, or None for the general one.
    A field mic gets its own list's words (Diagnosis -> diagnoses, Medications
    -> medicines); the whole-visit mic (field None) gets both lists in turn.
    Tested on real Whisper (14 synthetic ENT dictations): the hint holds only
    ~60 words, so one hint for everything left out many hard words."""
    vocab = load(department_code)
    if field is None:
        lists = [_hard_words(vocab[n], set()) for n in LISTS]
        words = [w for pair in zip_longest(*lists) for w in pair if w]
    elif field in FOR_FIELD:
        words = _hard_words(vocab[FOR_FIELD[field][0]], set())
    else:
        return None
    if not words:
        return None
    text = ""
    for w in words:
        nxt = f"{text}, {w}" if text else w
        if len(nxt) > WHISPER_WORDS_MAX_CHARS:
            break
        text = nxt
    return f"{terms_code(department_code).upper()} outpatient prescription. {text}. {WHISPER_TAIL}"


def prompt_section(department_code: str | None, target_field: str | None) -> str:
    """Preferred names for the extraction prompt, only for the fields being
    dictated (keeps the prompt short). Empty string when there is nothing."""
    vocab = load(department_code)
    wanted = FOR_FIELD.get(target_field, ()) if target_field else LISTS
    parts = []
    for name in wanted:
        terms = [
            t["name"] + (f" (also said: {', '.join(t['aliases'])})" if t["aliases"] else "")
            for t in vocab[name]
        ]
        if terms:
            label = "Diagnoses" if name == "diagnoses" else "Medicines"
            parts.append(f"{label}: " + "; ".join(terms))
    if not parts:
        return ""
    # Tested on real dictations: a bare "write it as listed" made the model drop
    # the side ("BPPV right side" -> "BPPV") and swap a dictated detail for the
    # listed wording ("central perforation" -> "tympanic membrane perforation").
    # The names may only fix the NAME; every other word stays.
    return (
        "Names used in this department for common diagnoses and medicines. Use them ONLY to "
        "correct how a name the doctor said is written (a mis-heard or misspelled name, or an "
        "abbreviation, may become the listed name). Change nothing else: keep every other word "
        "exactly as dictated - side (right/left/bilateral), site, type, extent and any other "
        "detail, strength, form (Tab./Syp./drops/spray), dose, frequency and duration - and keep "
        "the medication line format of rule 5. If the dictation is more specific than the "
        "listed name, keep the dictated detail. Never add a name that was not said.\n"
        "Examples: \"BPPV right side\" -> \"Benign paroxysmal positional vertigo (BPPV) right "
        "side\"; \"CSOM mucosal with central perforation\" -> \"Chronic otitis media - mucosal "
        "type with central perforation\" (the dictated \"central\" stays; it is not replaced by "
        "the listed wording).\n"
        + "\n".join(parts)
    )
