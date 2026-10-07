from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, true
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


class Patient(Base):
    """A patient of one department, shared by all its doctors. Two IDs:
    our own (`label`, e.g. ENT-000123, printed on every prescription) and,
    if known, the hospital's OPD number (unique within the department)."""

    __tablename__ = "patients"
    __table_args__ = (
        UniqueConstraint("department_id", "patient_no", name="uq_patients_department_patient_no"),
        UniqueConstraint("department_id", "opd_no", name="uq_patients_department_opd_no"),
    )

    id = Column(Integer, primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id"), index=True, nullable=False)
    patient_no = Column(Integer, nullable=False)  # 1, 2, 3 … per department
    opd_no = Column(String(40), nullable=True)  # NULL when not known (never "")
    full_name = Column(String(200), nullable=False, index=True)
    gender = Column(String(20), nullable=False)
    occupation = Column(String(120), nullable=False, default="", server_default="")
    city = Column(String(120), nullable=False, default="", server_default="")
    created_by = Column(Integer, ForeignKey("doctors.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    department = relationship(Department, lazy="joined")

    @property
    def label(self) -> str:
        return patient_label(self.department.code if self.department else "P", self.patient_no)


def patient_label(department_code: str, patient_no: int) -> str:
    return f"{department_code}-{patient_no:06d}"


class AccessLog(Base):
    """Who opened or wrote which patient's record, and when. Department-wide
    access to health data must be traceable."""

    __tablename__ = "access_log"

    id = Column(Integer, primary_key=True)
    at = Column(DateTime, default=_utcnow, nullable=False, index=True)
    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)
    form_id = Column(Integer, ForeignKey("clinical_forms.id"), nullable=True)
    # view_patient | view_visit | create_patient | create_visit | update_patient
    action = Column(String(30), nullable=False)


class ClinicalForm(Base):
    """One visit (a prescription) of a patient. Keeps its own copy of the
    patient details as they were on that day: a reprint always matches."""

    __tablename__ = "clinical_forms"

    id = Column(Integer, primary_key=True, index=True)
    pid = Column(String(32), unique=True, index=True, nullable=False)
    # Who saved it; each doctor only sees their own. NULL = saved before
    # accounts existed (visible to nobody).
    doctor_id = Column(Integer, ForeignKey("doctors.id"), index=True, nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), index=True, nullable=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), index=True, nullable=True)

    # Indexed for the records search (name contains / date range).
    # Any change to a column here needs an Alembic migration (backend/alembic/).
    patient_name = Column(String(200), nullable=False, index=True)
    date = Column(String(20), nullable=False, index=True)
    age = Column(String(40), nullable=False)  # e.g. "2 years 6 months"
    gender = Column(String(20), nullable=False)
    opd_no = Column(String(40), nullable=False, default="", server_default="")
    occupation = Column(String(120), nullable=False, default="", server_default="")
    city = Column(String(120), nullable=False, default="", server_default="")

    chief_complaints = Column(Text, nullable=False)
    on_examination = Column(Text, default="")
    diagnosis = Column(Text, nullable=False)
    investigation = Column(Text, default="")
    medications = Column(Text, default="")

    # Full raw transcripts kept for audit / re-parsing if extraction was wrong
    raw_transcript_log = Column(Text, default="")

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


ClinicalForm.patient = relationship(Patient, lazy="joined")
ClinicalForm.doctor = relationship(Doctor, lazy="joined")
