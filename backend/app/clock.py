"""
The app's clock. Times are STORED in UTC (naive datetimes, see models._utcnow),
but every date or time a person sees — or the app derives, like the date in a
Reference ID — is in APP_TIMEZONE (default India Standard Time), whatever
timezone the server itself runs in (cloud servers usually run UTC).
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from .config import settings

# On Windows, ZoneInfo needs the `tzdata` package (requirements.txt).
TZ = ZoneInfo(settings.APP_TIMEZONE)


def _now_utc() -> datetime:  # one place to fake "now" in tests
    return datetime.now(timezone.utc)


def local_now() -> datetime:
    return _now_utc().astimezone(TZ)


def local_today() -> date:
    return local_now().date()


def to_local_iso(stored_utc: datetime) -> str:
    """A stored (naive UTC) time as local time with its offset, e.g.
    2026-10-05T16:31:14+05:30 — unambiguous for any reader."""
    return stored_utc.replace(tzinfo=timezone.utc).astimezone(TZ).isoformat(timespec="seconds")
