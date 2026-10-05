"""
Startup schema upkeep. `Base.metadata.create_all()` creates missing TABLES but
never changes a table that already exists, so anything added to an existing
table (a column, an index) needs a step here. Every step is idempotent: it
checks first and does nothing if already applied. Run on every start.

(A real migration tool — Alembic — is the long-term answer; this keeps the
current SQLite database working without one.)
"""
import logging

from sqlalchemy import inspect, text

from .database import Base

logger = logging.getLogger(__name__)


def _columns(conn, table):
    return {c["name"] for c in inspect(conn).get_columns(table)}


def run(engine):
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        # Records search (added with "View past prescriptions").
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clinical_forms_patient_name ON clinical_forms (patient_name)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clinical_forms_date ON clinical_forms (date)"))

        # Owner of each prescription (added with doctor accounts).
        if "doctor_id" not in _columns(conn, "clinical_forms"):
            conn.execute(text("ALTER TABLE clinical_forms ADD COLUMN doctor_id INTEGER REFERENCES doctors(id)"))
            logger.info("migration: added clinical_forms.doctor_id")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clinical_forms_doctor_id ON clinical_forms (doctor_id)"))
