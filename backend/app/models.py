from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey, true
from sqlalchemy.orm import relationship

from .database import Base


def _utcnow() -> datetime:
    # Naive UTC, as before (SQLite stores no timezone), without the
    # deprecated utc-now helper on datetime.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def max_length(model, column: str):
    """Length limit of a text column, or None. PostgreSQL rejects longer text
    (a server error); SQLite stores it anyway. Check before saving so both
    databases behave the same and the user gets a clear message."""
    return getattr(model.__table__.c[column].type, "length", None)


class Department(Base):
    """An OPD department (ENT first). Doctors and prescriptions belong to one."""

    __tablename__ = "departments"

    id = Column(Integer, primary_key=True)
    code = Column(String(20), unique=True, nullable=False)  # "ENT"
    name = Column(String(120), nullable=False)  # printed: "ENT Department"
    created_at = Column(DateTime, default=_utcnow)


ROLES = ("doctor", "admin")


class Doctor(Base):
    """A user account. Signs in with email + password. Added by the
    department's admin (role "admin"), who may also write prescriptions."""

    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(120), nullable=False)
    # Sign-in name and reset address; stored lower-case.
    email = Column(String(254), unique=True, index=True, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), index=True, nullable=True)
    role = Column(String(20), nullable=False, default="doctor", server_default="doctor")
    # Deactivated: can't sign in; their prescriptions are kept.
    is_active = Column(Boolean, nullable=False, default=True, server_default=true())
    qualification = Column(String(120), default="")   # e.g. "MBBS, MD"
    specialization = Column(String(120), default="")  # e.g. "General Medicine"
    registration_no = Column(String(60), default="")  # medical council reg. no.
    # "scrypt$n$r$p$<salt b64>$<hash b64>" — never the password itself.
    # NO_PASSWORD until the doctor opens their set-password link.
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

    department = relationship(Department, lazy="joined")


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
    """One-time password link (token hashed, single use): "reset" (forgot
    password / sent by the admin) or "invite" (new account sets its first)."""

    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    purpose = Column(String(20), nullable=False, default="reset", server_default="reset")


class ClinicalForm(Base):
    __tablename__ = "clinical_forms"

    id = Column(Integer, primary_key=True, index=True)
    pid = Column(String(32), unique=True, index=True, nullable=False)
    # Who saved it; each doctor only sees their own. NULL = saved before
    # accounts existed (visible to nobody).
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), index=True, nullable=True)

    # Indexed for the records search (name contains / date range).
    # Any change to a column here needs an Alembic migration (backend/alembic/).
    patient_name = Column(String(200), nullable=False, index=True)
    date = Column(String(20), nullable=False, index=True)
    age = Column(String(40), nullable=False)  # e.g. "2 years 6 months"
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
