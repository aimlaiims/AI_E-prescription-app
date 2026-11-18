"""
Reports: files added to a saved visit — test reports (PDF or a photo of
one), endoscopy videos, clinical photos. Added after saving, also to earlier
visits; never printed; shown with the visit and in the patient's history.

The file goes to disk under REPORTS_DIR with a random name (never the name it
had on the device); the `reports` table keeps what it is and who added it.
What a file is comes from its first bytes, not from its name or what the
browser says, and it is served back only as that type: nothing uploaded can
become a web page.

What can be added (categories and their tests) is a data file per department,
app/report_types/<CODE>.json, read once per server start.
"""
import json
import logging
import secrets
import shutil
from functools import lru_cache
from pathlib import Path

from ..clock import to_local_iso
from ..config import settings
from ..models import Doctor, Report

logger = logging.getLogger(__name__)

TYPES_FOLDER = Path(__file__).resolve().parents[1] / "report_types"
MAX_TEST = 80
MAX_FILE_NAME = 200
MB = 1024 * 1024


@lru_cache(maxsize=None)
def categories(department_code: str | None) -> tuple[dict, ...]:
    """[{key, label, tests}] for the department (the demo department uses ENT's)."""
    if not department_code:
        return ()
    code = "ENT" if department_code.upper() == "DEMO" else department_code.upper()
    path = TYPES_FOLDER / f"{code}.json"
    if not path.is_file():
        return ()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return tuple(
            {"key": c["key"], "label": c["label"], "tests": [str(t) for t in c.get("tests", [])]}
            for c in data["categories"]
        )
    except (OSError, ValueError, KeyError, TypeError) as e:
        logger.error("Report list %s couldn't be read (%s); no reports can be added.", path.name, e)
        return ()


def for_doctor(doctor: Doctor) -> tuple[dict, ...]:
    return categories(doctor.department.code if doctor.department else None)


def check_choice(doctor: Doctor, category: str, test: str) -> tuple[str, str] | str:
    """(category, test) cleaned, or a plain-language problem. A category with
    tests needs one of them or a typed name ("Other"); one without takes none."""
    found = next((c for c in for_doctor(doctor) if c["key"] == category), None)
    if found is None:
        return "Please choose what kind of report this is."
    test = " ".join(test.split())
    if not found["tests"]:
        return category, ""
    if not test:
        return "Please choose the test, or type its name."
    if len(test) > MAX_TEST:
        return f"Please shorten the test name (at most {MAX_TEST} characters)."
    return category, test


def clean_file_name(name: str) -> str:
    """The name as shown to people: no folders, no control characters."""
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    if len(name) > MAX_FILE_NAME:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: MAX_FILE_NAME - len(ext) - 1] + "." + ext) if dot and len(ext) <= 10 else name[:MAX_FILE_NAME]
    return name or "file"


# --- What a file is, from its first bytes ---

HEAD_BYTES = 16
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"}


def sniff(head: bytes) -> str | None:
    """The media type of a file that starts with `head`, or None when it isn't
    a PDF, a picture or a video we accept."""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return "video/x-msvideo"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"  # WebM / Matroska
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _HEIF_BRANDS:
            return "image/heic"
        if brand == b"avif":
            return "image/avif"
        if brand == b"qt  ":
            return "video/quicktime"
        if brand.startswith(b"3g"):
            return "video/3gpp"
        return "video/mp4"
    return None


def kind(media_type: str) -> str:
    """"pdf" | "image" | "video" — how the app shows it."""
    return "pdf" if media_type == "application/pdf" else media_type.split("/", 1)[0]


# --- Storage ---

def folder() -> Path:
    return Path(settings.REPORTS_DIR).resolve()


def max_bytes() -> int:
    return int(settings.REPORT_MAX_FILE_MB * MB)


def new_path(today) -> str:
    """A new random place for a file, relative to the folder: 2026/11/<hex>."""
    return f"{today:%Y}/{today:%m}/{secrets.token_hex(16)}"


def room_for(size: int) -> bool:
    """Whether a file of `size` bytes fits and still leaves the minimum free."""
    base = folder()
    base.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(base).free
    return free - size >= settings.REPORTS_MIN_FREE_MB * MB


def file_of(report: Report) -> Path | None:
    """The report's file on disk, or None if it is missing (or the stored
    path would lead outside the folder)."""
    base = folder()
    path = (base / report.path).resolve()
    if base not in path.parents or not path.is_file():
        return None
    return path


def remove_file(relative: str) -> None:
    base = folder()
    path = (base / relative).resolve()
    if base in path.parents:
        path.unlink(missing_ok=True)


def stored(report: Report, viewer: Doctor | None = None) -> dict:
    return {
        "id": report.id,
        "category": report.category,
        "test": report.test,
        "file_name": report.file_name,
        "kind": kind(report.media_type),
        "media_type": report.media_type,
        "size": report.size,
        "uploaded_at": to_local_iso(report.created_at) if report.created_at else None,
        "uploaded_by": report.uploader.full_name if report.uploader else "",
        # Only the person who added a file may remove it.
        "mine": bool(viewer and report.uploaded_by == viewer.id),
    }
