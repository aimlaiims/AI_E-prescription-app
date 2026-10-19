"""
Doctor accounts: password hashing, session tokens, login throttling.
Standard library only (hashlib.scrypt, secrets, hmac) — no extra dependency.
"""
import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..config import settings
from ..models import AuthSession, Doctor, PasswordReset

# scrypt cost: n=2^14, r=8, p=1 (~16 MB, a few tens of ms) — the usual
# interactive-login setting. Stored with the hash so it can be raised later.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _DKLEN = 2**14, 8, 1, 32

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_DKLEN)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(hash_b64)
        dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, expected)


# A fixed hash to check against when the email has no account (or no password
# yet), so every failure takes as long as a wrong password (no probing).
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

# Stored for an account whose doctor hasn't opened their set-password link yet;
# matches no password.
NO_PASSWORD = "!"


def new_token() -> tuple[str, str]:
    """(token for the cookie/link, sha256 hex to store)."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def find_doctor(db: Session, email: str) -> Doctor | None:
    return db.query(Doctor).filter(Doctor.email == normalize_email(email)).first()


def authenticate(db: Session, email: str, password: str) -> Doctor | None:
    """The account if the password is right — active or not (the caller says
    "deactivated" only to someone who knows the password)."""
    doctor = find_doctor(db, email)
    if doctor is None or doctor.password_hash == NO_PASSWORD:
        verify_password(password, _DUMMY_HASH)  # equalise timing
        return None
    return doctor if verify_password(password, doctor.password_hash) else None


def create_session(db: Session, doctor: Doctor, remember: bool) -> tuple[str, datetime]:
    token, digest = new_token()
    lifetime = timedelta(days=settings.REMEMBER_DAYS) if remember else timedelta(hours=settings.SESSION_HOURS)
    expires = _utcnow() + lifetime
    db.add(AuthSession(token_hash=digest, doctor_id=doctor.id, expires_at=expires))
    db.commit()
    return token, expires


def doctor_for_token(db: Session, token: str | None) -> Doctor | None:
    if not token:
        return None
    row = db.query(AuthSession).filter(AuthSession.token_hash == token_hash(token)).first()
    if row is None:
        return None
    if row.expires_at <= _utcnow():
        db.delete(row)
        db.commit()
        return None
    doctor = db.get(Doctor, row.doctor_id)
    return doctor if doctor is not None and doctor.is_active and doctor.approved else None


def end_session(db: Session, token: str | None) -> None:
    if token:
        db.query(AuthSession).filter(AuthSession.token_hash == token_hash(token)).delete()
        db.commit()


def end_all_sessions(db: Session, doctor_id: int) -> None:
    db.query(AuthSession).filter(AuthSession.doctor_id == doctor_id).delete()
    db.commit()


class Throttle:
    """Failed attempts per key in a sliding window, in memory (resets when the
    server restarts — fine for one server; a shared store would be needed for
    several). Keys are e.g. "email:<address>" and "ip:<address>"."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def retry_after(self, key: str) -> float | None:
        """Seconds until another attempt is allowed, or None if allowed now."""
        now = time.monotonic()
        with self._lock:
            q = self._prune(key, now)
            if len(q) < self.limit:
                return None
            return max(1.0, self.window - (now - q[0]))

    def fail(self, key: str) -> None:
        with self._lock:
            self._prune(key, time.monotonic()).append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


RESET_LINK_MINUTES = 30  # "Forgot password" from the sign-in screen
ADMIN_RESET_LINK_HOURS = 24  # a reset link the admin sends or hands over


def create_password_reset(db: Session, doctor: Doctor, purpose: str = "reset", lifetime: timedelta | None = None) -> str:
    """New single-use link token (returned once, stored hashed). Any older
    unused link for this doctor stops working."""
    discard_password_links(db, doctor.id)
    token, digest = new_token()
    db.add(PasswordReset(
        token_hash=digest, doctor_id=doctor.id, purpose=purpose,
        expires_at=_utcnow() + (lifetime or timedelta(minutes=RESET_LINK_MINUTES)),
    ))
    db.commit()
    return token


def discard_password_links(db: Session, doctor_id: int) -> None:
    db.query(PasswordReset).filter(
        PasswordReset.doctor_id == doctor_id, PasswordReset.used_at.is_(None)
    ).delete()


def use_password_reset(db: Session, token: str, new_password: str) -> Doctor | None:
    """Set the new password if the token is valid, unused and not expired (and
    the account active); mark it used and end every session of that doctor.
    None if invalid."""
    row = db.query(PasswordReset).filter(PasswordReset.token_hash == token_hash(token or "")).first()
    if row is None or row.used_at is not None or row.expires_at <= _utcnow():
        return None
    doctor = db.get(Doctor, row.doctor_id)
    if doctor is None or not doctor.is_active:
        return None
    doctor.password_hash = hash_password(new_password)
    row.used_at = _utcnow()
    db.commit()
    end_all_sessions(db, doctor.id)
    return doctor


# 5 wrong passwords per account (email) per 15 min; a looser per-address limit
# so a clinic sharing one internet connection isn't locked out by one person.
login_by_email = Throttle(limit=5, window_seconds=15 * 60)
login_by_ip = Throttle(limit=30, window_seconds=15 * 60)
# Reset emails: 3 per address per 15 min (silently ignored beyond that).
forgot_by_key = Throttle(limit=3, window_seconds=15 * 60)
