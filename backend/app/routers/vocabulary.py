"""The signed-in doctor's department's common terms, for typing suggestions."""
from fastapi import APIRouter, Depends

from ..models import Doctor
from ..security import current_doctor
from ..services import vocabulary

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])


@router.get("")
def department_vocabulary(doctor: Doctor = Depends(current_doctor)):
    return vocabulary.load(doctor.department.code if doctor.department else None)
