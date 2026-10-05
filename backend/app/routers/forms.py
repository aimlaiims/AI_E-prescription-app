import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..clock import local_today, to_local_iso
from ..database import get_db
from ..models import ClinicalForm, Doctor, max_length
from ..security import current_doctor
from ..schemas import SaveFormRequest, SaveFormResponse, REQUIRED_FIELDS, FORM_FIELD_SPECS

router = APIRouter(prefix="/api/forms", tags=["forms"])


def _generate_pid() -> str:
    stamp = local_today().strftime("%Y%m%d")  # the IST date, not the server's
    # secrets, not random: Reference IDs should not be predictable.
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"RX-{stamp}-{suffix}"


@router.post("", response_model=SaveFormResponse)
def save_form(
    req: SaveFormRequest,
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    state = req.state.model_dump()

    # Iterate FORM_FIELD_SPECS (ordered) rather than the REQUIRED_FIELDS set
    # directly — set iteration order isn't guaranteed to match the form's
    # visual layout and can vary between process runs.
    missing = [
        f for f in FORM_FIELD_SPECS
        if f in REQUIRED_FIELDS and not state.get(f, "").strip()
    ]
    if missing:
        labels = ", ".join(FORM_FIELD_SPECS[f]["label"] for f in missing)
        raise HTTPException(
            400,
            {
                "error_code": "validation",
                "message": f"Please fill in {labels} before saving.",
            },
        )

    too_long = [
        f"{FORM_FIELD_SPECS[f]['label']} (at most {limit} characters)"
        for f in FORM_FIELD_SPECS
        if (limit := max_length(ClinicalForm, f)) and len(state.get(f, "")) > limit
    ]
    if too_long:
        raise HTTPException(
            400,
            {"error_code": "validation", "message": "Please shorten " + ", ".join(too_long) + "."},
        )

    # Collisions are extremely unlikely (36^4 per day), but bounded: an
    # unbounded retry loop would hang the request forever if they kept happening.
    for _ in range(10):
        pid = _generate_pid()
        if not db.query(ClinicalForm).filter(ClinicalForm.pid == pid).first():
            break
    else:
        raise HTTPException(
            503,
            {
                "error_code": "unavailable",
                "message": "Couldn't create a unique Reference ID. Please try saving again.",
            },
        )

    record = ClinicalForm(pid=pid, doctor_id=doctor.id, raw_transcript_log=req.raw_transcript_log, **state)
    db.add(record)
    db.commit()
    db.refresh(record)

    return SaveFormResponse(pid=pid, saved_at=to_local_iso(record.created_at))


@router.get("/{pid}")
def get_form(pid: str, db: Session = Depends(get_db), doctor: Doctor = Depends(current_doctor)):
    # Another doctor's record answers exactly like a missing one (no probing).
    record = (
        db.query(ClinicalForm)
        .filter(ClinicalForm.pid == pid, ClinicalForm.doctor_id == doctor.id)
        .first()
    )
    if not record:
        raise HTTPException(
            404,
            {
                "error_code": "not_found",
                "message": f"No saved prescription found for Reference ID {pid}.",
            },
        )
    return {
        c.name: getattr(record, c.name) for c in ClinicalForm.__table__.columns
    }


ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"


@router.get("")
def list_forms(
    q: str = Query("", max_length=100, description="Patient name or Reference ID, partial"),
    date_from: str | None = Query(None, pattern=ISO_DATE, description="Visit date >= (YYYY-MM-DD)"),
    date_to: str | None = Query(None, pattern=ISO_DATE, description="Visit date <= (YYYY-MM-DD)"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    """The signed-in doctor's saved prescriptions: newest visit first."""
    query = db.query(ClinicalForm).filter(ClinicalForm.doctor_id == doctor.id)
    needle = q.strip()
    if needle:
        # Case-insensitive "contains"; autoescape so % and _ are literal.
        query = query.filter(
            or_(
                func.lower(ClinicalForm.patient_name).contains(needle.lower(), autoescape=True),
                ClinicalForm.pid.contains(needle.upper(), autoescape=True),
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
                "age": r.age,
                "gender": r.gender,
                "date": r.date,
                "diagnosis": r.diagnosis,
                "created_at": to_local_iso(r.created_at),
            }
            for r in records
        ],
        "total": total,
        "has_more": offset + len(records) < total,
    }
