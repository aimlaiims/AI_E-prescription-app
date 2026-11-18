"""Patients of the signed-in doctor's department: find one, open their history.
(Patients are registered by saving their first prescription — forms.py.)"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ClinicalForm, Doctor
from ..security import current_doctor
from ..services import patients as patient_service

router = APIRouter(prefix="/api/patients", tags=["patients"])


@router.get("")
def find_patients(
    q: str = Query("", max_length=100, description="Name, Patient ID, OPD No. or city"),
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    """Matching patients (most recently seen first); without `q`, the latest."""
    return {"items": [patient_service.summary(db, p) for p in patient_service.search(db, doctor, q)]}


@router.get("/{patient_id}")
def patient_history(patient_id: int, db: Session = Depends(get_db), doctor: Doctor = Depends(current_doctor)):
    """The patient and every visit of theirs in this department, newest first."""
    patient = patient_service.in_department(db, doctor, patient_id)
    if patient is None:
        raise HTTPException(404, {"error_code": "not_found", "message": "That patient wasn't found in your department."})
    visits = (
        db.query(ClinicalForm).filter(ClinicalForm.patient_id == patient.id)
        .order_by(ClinicalForm.date.desc(), ClinicalForm.id.desc()).all()
    )
    patient_service.log_access(db, doctor, "view_patient", patient.id)
    db.commit()
    return {"patient": patient_service.summary(db, patient), "visits": [patient_service.visit(v, doctor) for v in visits]}
