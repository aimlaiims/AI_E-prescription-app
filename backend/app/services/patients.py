"""
Patients of a department: finding them, spotting likely duplicates, giving
new ones their Patient ID, and the access log.

Matching is deliberately simple and never automatic: the doctor always
decides whether a "possible duplicate" is the same person.
"""
import re

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clock import to_local_iso
from . import diagrams, reports
from ..models import AccessLog, ClinicalForm, Doctor, Patient

# "ENT-000123", "ent 123", "000123", "123"
_PATIENT_NO = re.compile(r"^(?:[a-z]{2,10}[-\s]?)?0*(\d{1,9})$", re.IGNORECASE)


def clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def opd_or_none(value: str) -> str | None:
    value = re.sub(r"\s+", "", value or "")
    return value or None


def log_access(db: Session, doctor: Doctor, action: str, patient_id: int | None = None, form_id: int | None = None):
    db.add(AccessLog(doctor_id=doctor.id, patient_id=patient_id, form_id=form_id, action=action))


def in_department(db: Session, doctor: Doctor, patient_id: int) -> Patient | None:
    patient = db.get(Patient, patient_id)
    return patient if patient is not None and patient.department_id == doctor.department_id else None


def by_opd(db: Session, department_id: int, opd_no: str | None, exclude_id: int | None = None) -> Patient | None:
    if not opd_no:
        return None
    q = db.query(Patient).filter(Patient.department_id == department_id, Patient.opd_no == opd_no)
    if exclude_id is not None:
        q = q.filter(Patient.id != exclude_id)
    return q.first()


def likely_duplicates(db: Session, department_id: int, name: str, city: str, opd_no: str | None) -> list[Patient]:
    """Same OPD No., or the same name (ignoring case and spacing) where the
    cities agree or one is unknown."""
    found = []
    same_opd = by_opd(db, department_id, opd_no)
    if same_opd:
        found.append(same_opd)
    name_key = clean_name(name).lower()
    if name_key:
        city_key = (city or "").strip().lower()
        for p in db.query(Patient).filter(
            Patient.department_id == department_id, func.lower(Patient.full_name) == name_key
        ).limit(20):
            other_city = (p.city or "").strip().lower()
            if (not city_key or not other_city or city_key == other_city) and p not in found:
                found.append(p)
    return found


def create_patient(db: Session, doctor: Doctor, *, full_name, gender, occupation, city, opd_no) -> Patient:
    """Register a patient with the next Patient ID of the department. Two
    registrations at the same instant can draw the same number: the unique
    constraint decides, and the loser draws again (bounded)."""
    for _ in range(10):
        last = db.query(func.max(Patient.patient_no)).filter(Patient.department_id == doctor.department_id).scalar()
        patient = Patient(
            department_id=doctor.department_id, patient_no=(last or 0) + 1, opd_no=opd_no,
            full_name=full_name, gender=gender, occupation=occupation, city=city, created_by=doctor.id,
        )
        db.add(patient)
        try:
            db.commit()
            return patient
        except IntegrityError:
            db.rollback()
            if by_opd(db, doctor.department_id, opd_no):
                raise  # the OPD No. was taken meanwhile: the caller says so
    raise RuntimeError("Couldn't allocate a Patient ID")


def search(db: Session, doctor: Doctor, q: str, limit: int = 20) -> list[Patient]:
    query = db.query(Patient).filter(Patient.department_id == doctor.department_id)
    q = (q or "").strip()
    if q:
        needle = q.lower()
        conditions = [
            func.lower(Patient.full_name).contains(needle, autoescape=True),
            func.lower(Patient.opd_no) == needle.replace(" ", ""),
            func.lower(Patient.city).contains(needle, autoescape=True),
        ]
        if m := _PATIENT_NO.match(q):
            conditions.append(Patient.patient_no == int(m.group(1)))
        query = query.filter(or_(*conditions))
    return query.order_by(Patient.updated_at.desc(), Patient.id.desc()).limit(limit).all()


def summary(db: Session, patient: Patient) -> dict:
    visits = db.query(ClinicalForm).filter(ClinicalForm.patient_id == patient.id)
    last = visits.order_by(ClinicalForm.date.desc(), ClinicalForm.id.desc()).first()
    return {
        "id": patient.id,
        "label": patient.label,
        "full_name": patient.full_name,
        "gender": patient.gender,
        "occupation": patient.occupation or "",
        "city": patient.city or "",
        "opd_no": patient.opd_no or "",
        "visit_count": visits.count(),
        "last_visit": (
            {"date": last.date, "age": last.age, "diagnosis": last.diagnosis} if last else None
        ),
    }


def visit(form: ClinicalForm, viewer: Doctor | None = None) -> dict:
    """A visit as stored (what a reprint shows), plus who wrote it and the
    files added to it (`viewer`: who is looking, for "may remove")."""
    return {
        "pid": form.pid,
        "patient_id": form.patient_id,
        "patient_label": form.patient.label if form.patient else "",
        "doctor_name": form.doctor.full_name if form.doctor else "",
        "patient_name": form.patient_name,
        "date": form.date,
        "age": form.age,
        "gender": form.gender,
        "opd_no": form.opd_no or "",
        "occupation": form.occupation or "",
        "city": form.city or "",
        "chief_complaints": form.chief_complaints,
        "on_examination": form.on_examination or "",
        "diagnosis": form.diagnosis,
        "investigation": form.investigation or "",
        "medications": form.medications or "",
        "advice": form.advice or "",
        "raw_transcript_log": form.raw_transcript_log or "",
        # Examination diagrams drawn on (not printed; shown in history).
        "drawings": [diagrams.stored(d) for d in form.drawings],
        # Files added after saving (not printed; services/reports.py).
        "reports": [reports.stored(r, viewer) for r in form.reports],
        "created_at": to_local_iso(form.created_at) if form.created_at else None,
    }
