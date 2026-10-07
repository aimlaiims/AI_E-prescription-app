"""
Accounts, managed by the department's administrator (role "admin"):
list, add (with a set-password link), edit, deactivate / reactivate, and send a
new password link. An admin only sees accounts of their own department, and
never sees prescriptions through these routes.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clock import to_local_iso
from ..config import settings
from ..database import get_db
from ..models import ROLES, Doctor, max_length
from ..schemas import DoctorFields
from ..security import current_admin
from ..services import auth as auth_service
from ..services.email import send_email
from .auth import APP_NAME, app_base_url, email_problem, invite_email, reset_email

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Labels for "Please enter …" messages; the limits come from the columns.
_TEXT_FIELDS = {
    "full_name": "a full name",
    "qualification": "a qualification",
    "specialization": "a specialization",
    "registration_no": "a registration number",
}


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message})


def account(d: Doctor) -> dict:
    return {
        "id": d.id,
        "full_name": d.full_name,
        "email": d.email,
        "qualification": d.qualification or "",
        "specialization": d.specialization or "",
        "registration_no": d.registration_no or "",
        "role": d.role,
        "is_active": d.is_active,
        "password_set": d.password_hash != auth_service.NO_PASSWORD,
        "created_at": to_local_iso(d.created_at) if d.created_at else None,
    }


def _clean(fields: DoctorFields) -> dict:
    """Trimmed values, or a 400 listing everything to fix."""
    values = {k: getattr(fields, k).strip() for k in _TEXT_FIELDS}
    values["email"] = auth_service.normalize_email(fields.email)
    values["role"] = fields.role
    problems = []
    if not values["full_name"]:
        problems.append("a full name")
    if problem := email_problem(values["email"]):
        problems.append(problem)
    for field, label in _TEXT_FIELDS.items():
        limit = max_length(Doctor, field)
        if len(values[field]) > limit:
            problems.append(f"{label} of at most {limit} characters")
    if values["role"] not in ROLES:
        problems.append("a role (doctor or admin)")
    if problems:
        raise _error(400, "validation", "Please enter " + ", ".join(problems) + ".")
    return values


def _in_department(db: Session, admin: Doctor, doctor_id: int) -> Doctor:
    doctor = db.get(Doctor, doctor_id)
    if doctor is None or doctor.department_id != admin.department_id:
        raise _error(404, "not_found", "No such account.")
    return doctor


def _other_active_admins(db: Session, admin: Doctor, doctor: Doctor) -> int:
    return db.query(Doctor).filter(
        Doctor.department_id == admin.department_id, Doctor.role == "admin",
        Doctor.is_active.is_(True), Doctor.id != doctor.id,
    ).count()


def _send_link(request: Request, db: Session, admin: Doctor, doctor: Doctor) -> dict:
    """A set-password link (account never used) or a reset link: emailed if
    possible, otherwise returned so the admin can pass it on in person."""
    department = admin.department.name if admin.department else ""
    if doctor.password_hash == auth_service.NO_PASSWORD:
        token = auth_service.create_password_reset(
            db, doctor, purpose="invite", lifetime=timedelta(days=settings.INVITE_LINK_DAYS))
        link = f"{app_base_url(request)}/?setup={token}"
        emailed = send_email(doctor.email, f"Your {APP_NAME} account", invite_email(doctor, link, department))
        valid_for = f"{settings.INVITE_LINK_DAYS} days"
    else:
        token = auth_service.create_password_reset(
            db, doctor, lifetime=timedelta(hours=auth_service.ADMIN_RESET_LINK_HOURS))
        link = f"{app_base_url(request)}/?reset={token}"
        valid_for = f"{auth_service.ADMIN_RESET_LINK_HOURS} hours"
        emailed = send_email(doctor.email, f"Reset your {APP_NAME} password", reset_email(doctor, link, valid_for))
    # The link itself only when the email didn't go out (it is a password key).
    return {"emailed": emailed, "link": None if emailed else link, "valid_for": valid_for}


@router.get("/doctors")
def list_doctors(db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    rows = (
        db.query(Doctor).filter(Doctor.department_id == admin.department_id)
        .order_by(Doctor.is_active.desc(), Doctor.full_name).all()
    )
    return {"items": [account(d) for d in rows]}


@router.post("/doctors")
def add_doctor(fields: DoctorFields, request: Request, db: Session = Depends(get_db),
               admin: Doctor = Depends(current_admin)):
    values = _clean(fields)
    if auth_service.find_doctor(db, values["email"]):
        raise _error(409, "conflict", "An account with this email already exists.")
    doctor = Doctor(**values, department_id=admin.department_id, password_hash=auth_service.NO_PASSWORD)
    db.add(doctor)
    try:
        db.commit()
    except IntegrityError:  # the same email added a moment ago, in parallel
        db.rollback()
        raise _error(409, "conflict", "An account with this email already exists.")
    db.refresh(doctor)
    return {"doctor": account(doctor), **_send_link(request, db, admin, doctor)}


@router.patch("/doctors/{doctor_id}")
def edit_doctor(doctor_id: int, fields: DoctorFields, db: Session = Depends(get_db),
                admin: Doctor = Depends(current_admin)):
    doctor = _in_department(db, admin, doctor_id)
    values = _clean(fields)
    if values["role"] != "admin" and doctor.role == "admin" and not _other_active_admins(db, admin, doctor):
        raise _error(400, "validation", "The department needs at least one active administrator.")
    if values["email"] != doctor.email and auth_service.find_doctor(db, values["email"]):
        raise _error(409, "conflict", "An account with this email already exists.")
    for k, v in values.items():
        setattr(doctor, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _error(409, "conflict", "An account with this email already exists.")
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/deactivate")
def deactivate(doctor_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    doctor = _in_department(db, admin, doctor_id)
    if doctor.id == admin.id:
        raise _error(400, "validation", "You can't deactivate your own account.")
    if doctor.role == "admin" and not _other_active_admins(db, admin, doctor):
        raise _error(400, "validation", "The department needs at least one active administrator.")
    doctor.is_active = False
    auth_service.discard_password_links(db, doctor.id)
    db.commit()
    auth_service.end_all_sessions(db, doctor.id)  # signed out everywhere, now
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/activate")
def activate(doctor_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    doctor = _in_department(db, admin, doctor_id)
    doctor.is_active = True
    db.commit()
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/password-link")
def password_link(doctor_id: int, request: Request, db: Session = Depends(get_db),
                  admin: Doctor = Depends(current_admin)):
    doctor = _in_department(db, admin, doctor_id)
    if not doctor.is_active:
        raise _error(400, "validation", "Reactivate this account first.")
    return {"doctor": account(doctor), **_send_link(request, db, admin, doctor)}
