import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clock import local_today, to_local_iso
from ..database import get_db
from ..models import ClinicalForm, Doctor, Patient, max_length
from ..security import current_doctor
from ..schemas import SaveFormRequest, REQUIRED_FIELDS, FORM_FIELD_SPECS
from ..services import patients as patient_service

router = APIRouter(prefix="/api/forms", tags=["forms"])


def _generate_pid() -> str:
    stamp = local_today().strftime("%Y%m%d")  # the IST date, not the server's
    # secrets, not random: Reference IDs should not be predictable.
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"RX-{stamp}-{suffix}"


def _error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message, **extra})


def _opd_taken(owner: Patient) -> HTTPException:
    label = FORM_FIELD_SPECS["opd_no"]["label"]
    return _error(409, "conflict", f"That {label} belongs to another patient ({owner.label}, {owner.full_name}).")


def _validate(state: dict) -> None:
    # Iterate FORM_FIELD_SPECS (ordered) rather than the REQUIRED_FIELDS set
    # directly — set iteration order isn't guaranteed to match the form's
    # visual layout and can vary between process runs.
    missing = [f for f in FORM_FIELD_SPECS if f in REQUIRED_FIELDS and not state.get(f, "").strip()]
    if missing:
        labels = ", ".join(FORM_FIELD_SPECS[f]["label"] for f in missing)
        raise _error(400, "validation", f"Please fill in {labels} before saving.")
    too_long = [
        f"{FORM_FIELD_SPECS[f]['label']} (at most {limit} characters)"
        for f in FORM_FIELD_SPECS
        if (limit := max_length(ClinicalForm, f)) and len(state.get(f, "")) > limit
    ]
    if too_long:
        raise _error(400, "validation", "Please shorten " + ", ".join(too_long) + ".")


def _patient_for_visit(db: Session, doctor: Doctor, req: SaveFormRequest, state: dict) -> Patient:
    """The visit's patient: the one chosen (whose details are brought up to
    date from this form), or a newly registered one — but first, if likely
    duplicates exist, the doctor is asked ("possible_duplicate")."""
    details = {
        "full_name": patient_service.clean_name(state["patient_name"]),
        "gender": state["gender"].strip(),
        "occupation": state["occupation"].strip(),
        "city": state["city"].strip(),
        "opd_no": patient_service.opd_or_none(state["opd_no"]),
    }
    if req.patient_id is not None:
        patient = patient_service.in_department(db, doctor, req.patient_id)
        if patient is None:
            raise _error(404, "not_found", "That patient wasn't found in your department.")
        if owner := patient_service.by_opd(db, doctor.department_id, details["opd_no"], exclude_id=patient.id):
            raise _opd_taken(owner)
        # Only real changes: the same name typed in capitals, or a city with
        # different spacing, must not rewrite the record — and a field left
        # empty on this visit never erases what the record already knows.
        def same(a, b):
            return patient_service.clean_name(a or "").lower() == patient_service.clean_name(b or "").lower()
        changed = {k: v for k, v in details.items() if v and not same(getattr(patient, k), v)}
        for k, v in changed.items():
            setattr(patient, k, v)
        if changed:
            patient_service.log_access(db, doctor, "update_patient", patient.id)
        db.commit()
        return patient

    candidates = patient_service.likely_duplicates(
        db, doctor.department_id, details["full_name"], details["city"], details["opd_no"])
    if (owner := patient_service.by_opd(db, doctor.department_id, details["opd_no"])) and req.new_patient:
        raise _opd_taken(owner)  # an OPD No. belongs to one patient only
    if candidates and not req.new_patient:
        raise _error(409, "possible_duplicate", "This may be a patient who is already registered.",
                     candidates=[patient_service.summary(db, p) for p in candidates])
    try:
        patient = patient_service.create_patient(db, doctor, **details)
    except IntegrityError:
        raise _opd_taken(patient_service.by_opd(db, doctor.department_id, details["opd_no"]))
    patient_service.log_access(db, doctor, "create_patient", patient.id)
    db.commit()
    return patient


@router.post("")
def save_form(req: SaveFormRequest, db: Session = Depends(get_db), doctor: Doctor = Depends(current_doctor)):
    state = req.state.model_dump()
    _validate(state)
    patient = _patient_for_visit(db, doctor, req, state)

    # The database's unique constraint is the real guard: two saves at the same
    # instant could both pass a "does this ID exist?" check. On a clash, roll
    # back and draw a new ID. Clashes are extremely unlikely (36^4 per day),
    # but bounded: an endless loop would hang the request if they kept happening.
    for _ in range(10):
        record = ClinicalForm(
            pid=_generate_pid(), doctor_id=doctor.id, department_id=doctor.department_id,
            patient_id=patient.id, raw_transcript_log=req.raw_transcript_log, **state
        )
        db.add(record)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
    else:
        raise _error(503, "unavailable", "Couldn't create a unique Reference ID. Please try saving again.")
    patient_service.log_access(db, doctor, "create_visit", patient.id, record.id)
    db.commit()
    db.refresh(record)
    return {
        "pid": record.pid,
        "saved_at": to_local_iso(record.created_at),
        "patient": patient_service.summary(db, patient),
    }


@router.get("/{pid}")
def get_form(pid: str, db: Session = Depends(get_db), doctor: Doctor = Depends(current_doctor)):
    # Every prescription of the department; another department's answers
    # exactly like a missing one (no probing).
    record = (
        db.query(ClinicalForm)
        .filter(ClinicalForm.pid == pid, ClinicalForm.department_id == doctor.department_id)
        .first()
    )
    if not record:
        raise _error(404, "not_found", f"No saved prescription found for Reference ID {pid}.")
    patient_service.log_access(db, doctor, "view_visit", record.patient_id, record.id)
    db.commit()
    return patient_service.visit(record)


ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"


@router.get("")
def list_forms(
    q: str = Query("", max_length=100, description="Patient name, Patient ID, OPD No. or Reference ID, partial"),
    date_from: str | None = Query(None, pattern=ISO_DATE, description="Visit date >= (YYYY-MM-DD)"),
    date_to: str | None = Query(None, pattern=ISO_DATE, description="Visit date <= (YYYY-MM-DD)"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    """The department's saved prescriptions: newest visit first."""
    query = db.query(ClinicalForm).filter(ClinicalForm.department_id == doctor.department_id)
    needle = q.strip()
    if needle:
        # Case-insensitive "contains"; autoescape so % and _ are literal.
        matching_patients = [p.id for p in patient_service.search(db, doctor, needle, limit=200)]
        query = query.filter(
            or_(
                func.lower(ClinicalForm.patient_name).contains(needle.lower(), autoescape=True),
                ClinicalForm.pid.contains(needle.upper(), autoescape=True),
                ClinicalForm.patient_id.in_(matching_patients),
            )
        )
    if date_from:
        query = query.filter(ClinicalForm.date >= date_from)
    if date_to:
        query = query.filter(ClinicalForm.date <= date_to)

    total = query.count()
    records = (
        query.order_by(ClinicalForm.date.desc(), ClinicalForm.created_at.desc(), ClinicalForm.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "pid": r.pid,
                "patient_name": r.patient_name,
                "patient_label": r.patient.label if r.patient else "",
                "age": r.age,
                "gender": r.gender,
                "date": r.date,
                "diagnosis": r.diagnosis,
                "doctor_name": r.doctor.full_name if r.doctor else "",
                "created_at": to_local_iso(r.created_at),
            }
            for r in records
        ],
        "total": total,
        "has_more": offset + len(records) < total,
    }
