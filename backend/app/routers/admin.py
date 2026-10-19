"""
Accounts, managed by the administrator (role "admin"; there is one, made on
the server with tools/create_admin.py). Covers every department:
- registration codes: create one per new doctor, see their state, revoke;
- new registrations: approve or reject;
- accounts: correct details, deactivate / reactivate, send a password link.
Nothing here makes anyone an administrator, and the administrator never sees
prescriptions through these routes (their own clinical records stay in their
own department, like everyone's).
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clock import to_local_iso
from ..config import settings
from ..database import get_db
from ..models import Department, Doctor, RegistrationCode, max_length
from ..schemas import CodeRequest, DoctorFields
from ..security import current_admin
from ..services import auth as auth_service
from ..services import registration
from ..services.email import send_email
from .auth import APP_NAME, PROFILE_LABELS, app_base_url, email_problem, invite_email, reset_email

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message})


def _department(d: Department | None) -> dict | None:
    return {"id": d.id, "code": d.code, "name": d.name} if d else None


def account(d: Doctor) -> dict:
    return {
        "id": d.id,
        "full_name": d.full_name,
        "email": d.email,
        "designation": d.designation or "",
        "qualification": d.qualification or "",
        "specialization": d.specialization or "",
        "registration_no": d.registration_no or "",
        "role": d.role,
        "is_active": d.is_active,
        "approved": d.approved,
        "password_set": d.password_hash != auth_service.NO_PASSWORD,
        "department": _department(d.department),
        "created_at": to_local_iso(d.created_at) if d.created_at else None,
    }


def _clean(fields: DoctorFields) -> dict:
    """Trimmed values, or a 400 listing everything to fix."""
    values = {k: getattr(fields, k).strip() for k in PROFILE_LABELS}
    values["email"] = auth_service.normalize_email(fields.email)
    problems = []
    if not values["full_name"]:
        problems.append("a full name")
    if problem := email_problem(values["email"]):
        problems.append(problem)
    for field, label in PROFILE_LABELS.items():
        limit = max_length(Doctor, field)
        if len(values[field]) > limit:
            problems.append(f"{label} of at most {limit} characters")
    if problems:
        raise _error(400, "validation", "Please enter " + ", ".join(problems) + ".")
    return values


def _doctor(db: Session, doctor_id: int) -> Doctor:
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise _error(404, "not_found", "No such account.")
    return doctor


def _send_link(request: Request, db: Session, doctor: Doctor) -> dict:
    """A reset link (or, for an account that never set a password, a
    set-password link): emailed if possible, otherwise returned so the admin
    can pass it on in person."""
    department = doctor.department.name if doctor.department else ""
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


# --- departments and registration codes -----------------------------------------

@router.get("/departments")
def departments(db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    return {"items": [_department(d) for d in db.query(Department).order_by(Department.id)]}


def _code(row: RegistrationCode, db: Session) -> dict:
    used_by = db.get(Doctor, row.used_by) if row.used_by else None
    return {
        "id": row.id,
        "status": registration.status(row),
        "department": _department(row.department),
        "note": row.note or "",
        "created_at": to_local_iso(row.created_at) if row.created_at else None,
        "expires_at": to_local_iso(row.expires_at),
        "used_at": to_local_iso(row.used_at) if row.used_at else None,
        "used_by": {"full_name": used_by.full_name, "email": used_by.email} if used_by else None,
    }


@router.get("/codes")
def list_codes(db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    rows = db.query(RegistrationCode).order_by(RegistrationCode.id.desc()).limit(50).all()
    return {"items": [_code(r, db) for r in rows]}


@router.post("/codes")
def create_code(req: CodeRequest, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    """A new one-time code. The code itself is returned only here, once."""
    department = db.get(Department, req.department_id) if req.department_id else None
    if department is None:
        department = db.query(Department).filter(Department.code == "ENT").first()
    if department is None:
        raise _error(400, "validation", "Please choose a department.")
    note = req.note.strip()
    limit = max_length(RegistrationCode, "note")
    if len(note) > limit:
        raise _error(400, "validation", f"Please enter a note of at most {limit} characters.")
    row, code = registration.create(db, admin, department.id, note)
    return {"code": code, "valid_hours": settings.REGISTRATION_CODE_HOURS, **_code(row, db)}


@router.post("/codes/{code_id}/revoke")
def revoke_code(code_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    row = db.get(RegistrationCode, code_id)
    if row is None:
        raise _error(404, "not_found", "No such code.")
    if registration.status(row) == "open":
        row.revoked_at = auth_service._utcnow()
        db.commit()
    return _code(row, db)


# --- accounts ---------------------------------------------------------------------

@router.get("/doctors")
def list_doctors(db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    # Waiting for approval first, then active, then deactivated.
    rows = db.query(Doctor).order_by(
        Doctor.approved.asc(), Doctor.is_active.desc(), Doctor.full_name).all()
    return {"items": [account(d) for d in rows]}


@router.post("/doctors/{doctor_id}/approve")
def approve(doctor_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    doctor = _doctor(db, doctor_id)
    doctor.approved = True
    doctor.is_active = True
    db.commit()
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/reject")
def reject(doctor_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    """A registration that isn't right: the account is deactivated (kept for
    the record, can't sign in). Only for registrations not yet approved."""
    doctor = _doctor(db, doctor_id)
    if doctor.approved:
        raise _error(400, "validation", "This account is already approved; deactivate it instead.")
    doctor.is_active = False
    db.commit()
    auth_service.end_all_sessions(db, doctor.id)
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.patch("/doctors/{doctor_id}")
def edit_doctor(doctor_id: int, fields: DoctorFields, db: Session = Depends(get_db),
                admin: Doctor = Depends(current_admin)):
    doctor = _doctor(db, doctor_id)
    values = _clean(fields)
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
    doctor = _doctor(db, doctor_id)
    if doctor.id == admin.id or doctor.role == "admin":
        raise _error(400, "validation", "The administrator's account can't be deactivated here.")
    doctor.is_active = False
    auth_service.discard_password_links(db, doctor.id)
    db.commit()
    auth_service.end_all_sessions(db, doctor.id)  # signed out everywhere, now
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/activate")
def activate(doctor_id: int, db: Session = Depends(get_db), admin: Doctor = Depends(current_admin)):
    doctor = _doctor(db, doctor_id)
    doctor.is_active = True
    db.commit()
    db.refresh(doctor)
    return {"doctor": account(doctor)}


@router.post("/doctors/{doctor_id}/password-link")
def password_link(doctor_id: int, request: Request, db: Session = Depends(get_db),
                  admin: Doctor = Depends(current_admin)):
    doctor = _doctor(db, doctor_id)
    if not doctor.is_active or not doctor.approved:
        raise _error(400, "validation", "This account isn't active; approve or reactivate it first.")
    return {"doctor": account(doctor), **_send_link(request, db, doctor)}
