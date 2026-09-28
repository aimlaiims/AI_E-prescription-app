from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime

from .database import Base


class ClinicalForm(Base):
    __tablename__ = "clinical_forms"

    id = Column(Integer, primary_key=True, index=True)
    pid = Column(String(32), unique=True, index=True, nullable=False)

    patient_name = Column(String(200), nullable=False)
    date = Column(String(20), nullable=False)
    age = Column(String(10), nullable=False)
    gender = Column(String(20), nullable=False)

    chief_complaints = Column(Text, nullable=False)
    on_examination = Column(Text, default="")
    diagnosis = Column(Text, nullable=False)
    investigation = Column(Text, default="")
    medications = Column(Text, default="")

    # Full raw transcripts kept for audit / re-parsing if extraction was wrong
    raw_transcript_log = Column(Text, default="")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
