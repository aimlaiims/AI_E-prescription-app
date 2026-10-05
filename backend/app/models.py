from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey

from .database import Base


def _utcnow() -> datetime:
    # Naive UTC, as before (SQLite stores no timezone), without the
    # deprecated utc-now helper on datetime.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True)
    # Login name, stored lower-case (case-insensitive login).
    doctor_id = Column(String(40), unique=True, index=True, nullable=False)
    full_name = Column(String(120), nullable=False)
    email = Column(String(254), unique=True, index=True, nullable=False)
    qualification = Column(String(120), default="")   # e.g. "MBBS, MD"
    specialization = Column(String(120), default="")  # e.g. "General Medicine"
    registration_no = Column(String(60), default="")  # medical council reg. no.
    # "scrypt$n$r$p$<salt b64>$<hash b64>" — never the password itself.
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class AuthSession(Base):
    """A signed-in browser. The cookie holds a random token; only its SHA-256
    is stored, so a copy of the database can't be used to log in."""

    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=False)


class PasswordReset(Base):
    """One-time password-reset link (token hashed, short-lived, single use)."""

    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class ClinicalForm(Base):
    __tablename__ = "clinical_forms"

    id = Column(Integer, primary_key=True, index=True)
    pid = Column(String(32), unique=True, index=True, nullable=False)
    # Who saved it; each doctor only sees their own. Added to existing
    # databases by migrations.py. NULL = saved before accounts existed.
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=True)

    # Indexed for the records search (name contains / date range). Existing
    # databases get these via CREATE INDEX IF NOT EXISTS in main.py, because
    # create_all() never alters a table that already exists.
    patient_name = Column(String(200), nullable=False, index=True)
    date = Column(String(20), nullable=False, index=True)
    age = Column(String(10), nullable=False)
    gender = Column(String(20), nullable=False)

    chief_complaints = Column(Text, nullable=False)
    on_examination = Column(Text, default="")
    diagnosis = Column(Text, nullable=False)
    investigation = Column(Text, default="")
    medications = Column(Text, default="")

    # Full raw transcripts kept for audit / re-parsing if extraction was wrong
    raw_transcript_log = Column(Text, default="")

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
