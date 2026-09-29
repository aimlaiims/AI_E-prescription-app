from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime

from .database import Base


def _utcnow() -> datetime:
    # Naive UTC, as before (SQLite stores no timezone), without the
    # deprecated utc-now helper on datetime.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ClinicalForm(Base):
    __tablename__ = "clinical_forms"

    id = Column(Integer, primary_key=True, index=True)
    pid = Column(String(32), unique=True, index=True, nullable=False)

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
