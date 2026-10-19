"""
One-time registration codes (the administrator creates one per new doctor).

- 8 characters from 32 letters and digits without look-alikes (no 0/O, 1/I),
  shown as K7QX-M4PZ: about a trillion possibilities.
- Single use; expires (REGISTRATION_CODE_HOURS, default 72).
- Stored as a scrypt hash with its own salt, like a password: a stolen copy of
  the database can't be turned back into usable codes. Checking a code compares
  it with the few codes still open (unused, unexpired, not revoked).
- Wrong guesses are limited per address and overall (see the throttles).
"""
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Doctor, RegistrationCode
from . import auth as auth_service

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LENGTH = 8

# 5 wrong codes per address per 15 min; 50 overall (spread-out guessing).
check_by_ip = auth_service.Throttle(limit=5, window_seconds=15 * 60)
check_overall = auth_service.Throttle(limit=50, window_seconds=15 * 60)


def normalize(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
    return f"{raw[:4]}-{raw[4:]}"


def create(db: Session, admin: Doctor | None, department_id: int, note: str) -> tuple[RegistrationCode, str]:
    code = new_code()
    row = RegistrationCode(
        code_hash=auth_service.hash_password(normalize(code)), department_id=department_id,
        note=note, created_by=admin.id if admin else None,
        expires_at=auth_service._utcnow() + timedelta(hours=settings.REGISTRATION_CODE_HOURS),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, code


def find_open(db: Session, code: str) -> RegistrationCode | None:
    """The open code matching what was typed, or None."""
    typed = normalize(code)
    if len(typed) != LENGTH:
        return None
    now = auth_service._utcnow()
    open_codes = db.query(RegistrationCode).filter(
        RegistrationCode.used_at.is_(None), RegistrationCode.revoked_at.is_(None),
        RegistrationCode.expires_at > now,
    ).all()
    for row in open_codes:
        if auth_service.verify_password(typed, row.code_hash):
            return row
    return None


def status(row: RegistrationCode) -> str:
    if row.used_at:
        return "used"
    if row.revoked_at:
        return "revoked"
    if row.expires_at <= auth_service._utcnow():
        return "expired"
    return "open"
