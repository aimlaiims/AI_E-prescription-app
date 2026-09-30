import random
import string
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ClinicalForm
from ..schemas import SaveFormRequest, SaveFormResponse, REQUIRED_FIELDS, FORM_FIELD_SPECS

router = APIRouter(prefix="/api/forms", tags=["forms"])


def _generate_pid() -> str:
    stamp = date.today().strftime("%Y%m%d")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"RX-{stamp}-{suffix}"


@router.post("", response_model=SaveFormResponse)
def save_form(req: SaveFormRequest, db: Session = Depends(get_db)):
    state = req.state.model_dump()

    missing = [f for f in REQUIRED_FIELDS if not state.get(f, "").strip()]
    if missing:
        labels = [FORM_FIELD_SPECS[f]["label"] for f in missing]
        # `error_code: "validation"` (not one of the upstream codes) so the
        # frontend shows this message directly — it's a real, actionable thing
        # for the doctor to fix, not a voice-service failure to soften.
        raise HTTPException(
            400,
            {
                "error_code": "validation",
                "message": f"Please fill in: {', '.join(labels)}",
            },
        )

    pid = _generate_pid()
    # extremely unlikely, but guard against PID collision
    while db.query(ClinicalForm).filter(ClinicalForm.pid == pid).first():
        pid = _generate_pid()

    record = ClinicalForm(pid=pid, raw_transcript_log=req.raw_transcript_log, **state)
    db.add(record)
    db.commit()
    db.refresh(record)

    return SaveFormResponse(pid=pid, saved_at=record.created_at.isoformat())


@router.get("/{pid}")
def get_form(pid: str, db: Session = Depends(get_db)):
    record = db.query(ClinicalForm).filter(ClinicalForm.pid == pid).first()
    if not record:
        raise HTTPException(404, "Form not found")
    return {
        c.name: getattr(record, c.name) for c in ClinicalForm.__table__.columns
    }


@router.get("")
def list_forms(db: Session = Depends(get_db)):
    records = db.query(ClinicalForm).order_by(ClinicalForm.created_at.desc()).limit(100).all()
    return [
        {
            "pid": r.pid,
            "patient_name": r.patient_name,
            "date": r.date,
            "diagnosis": r.diagnosis,
            "created_at": r.created_at.isoformat(),
        }
        for r in records
    ]
