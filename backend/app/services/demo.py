"""
"Try the demo" on the sign-in screen (DEMO_LOGIN=true in .env, off by default).

It signs in as one demo doctor of its own department, so whoever has the link
sees only the demo's own practice prescriptions, never a real department's
patients, and never anything an administrator can do. Turning DEMO_LOGIN off
also ends any demo session still open (security.current_doctor).
"""
import secrets

from sqlalchemy.orm import Session

from ..models import Department, Doctor
from . import auth as auth_service

DEPARTMENT_CODE = "DEMO"
DEPARTMENT_NAME = "ENT Department (demo)"  # printed: demo printouts say so
EMAIL = "demo@demo.invalid"  # .invalid: can never be someone's real address
FULL_NAME = "Demo Doctor"
# Dictation and suggestions use this department's term lists.
TERMS_FROM = "ENT"


def is_demo(doctor: Doctor) -> bool:
    return doctor.email == EMAIL


def demo_doctor(db: Session) -> Doctor | None:
    """The demo account, created on first use. None if that email is somehow
    not the plain demo doctor (never sign anyone else in by this route)."""
    department = db.query(Department).filter(Department.code == DEPARTMENT_CODE).first()
    if department is None:
        department = Department(code=DEPARTMENT_CODE, name=DEPARTMENT_NAME)
        db.add(department)
        db.flush()
    doctor = auth_service.find_doctor(db, EMAIL)
    if doctor is None:
        doctor = Doctor(
            full_name=FULL_NAME, email=EMAIL, role="doctor", department_id=department.id,
            # Nobody knows this password: the demo is entered only by the button.
            password_hash=auth_service.hash_password(secrets.token_urlsafe(32)),
        )
        db.add(doctor)
        db.commit()
        db.refresh(doctor)
    else:
        db.commit()
    if doctor.role != "doctor" or doctor.department_id != department.id:
        return None
    return doctor
