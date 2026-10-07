import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Doctor, max_length
from ..schemas import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, SignupRequest
from ..security import SESSION_COOKIE, clear_session_cookie, current_doctor, set_session_cookie
from ..services import auth as auth_service
from ..services.email import send_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DOCTOR_ID = re.compile(r"^[a-z0-9._-]{3,40}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Profile fields with a length limit in the database (doctor_id: the regex above).
_PROFILE_LABELS = {
    "full_name": "a full name",
    "email": "an email address",
    "qualification": "a qualification",
    "specialization": "a specialization",
    "registration_no": "a registration number",
}


def _error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message, **extra})


def profile(doctor: Doctor) -> dict:
    """What the app needs about the signed-in doctor (letterhead, navbar)."""
    return {
        "doctor": {
            "doctor_id": doctor.doctor_id,
            "full_name": doctor.full_name,
            "email": doctor.email,
            "qualification": doctor.qualification,
            "specialization": doctor.specialization,
            "registration_no": doctor.registration_no,
        },
        "institution": settings.INSTITUTION_NAME,
    }


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/signup")
def signup(req: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if not settings.SIGNUP_CODE:
        raise _error(403, "signup_disabled", "Sign-up is not open. Ask the administrator for an account.")
    if not auth_service.signup_code_ok(req.invite_code):
        raise _error(403, "invalid_invite", "That invite code isn't right. Check it with the administrator.")

    doctor_id = auth_service.normalize_doctor_id(req.doctor_id)
    email = auth_service.normalize_email(req.email)
    problems = []
    if not req.full_name.strip():
        problems.append("your full name")
    if not _DOCTOR_ID.match(doctor_id):
        problems.append("a Doctor ID of 3–40 letters, numbers, dots, dashes or underscores")
    if not _EMAIL.match(email):
        problems.append("a valid email address")
    for field, label in _PROFILE_LABELS.items():
        limit = max_length(Doctor, field)
        if len(getattr(req, field).strip()) > limit:
            problems.append(f"{label} of at most {limit} characters")
    if not (auth_service.MIN_PASSWORD_LENGTH <= len(req.password) <= auth_service.MAX_PASSWORD_LENGTH):
        problems.append(f"a password of at least {auth_service.MIN_PASSWORD_LENGTH} characters")
    if problems:
        raise _error(400, "validation", "Please enter " + ", ".join(problems) + ".")

    taken = db.query(Doctor).filter((Doctor.doctor_id == doctor_id) | (Doctor.email == email)).first()
    if taken:
        raise _error(409, "conflict", "That Doctor ID or email is already registered. Try signing in instead.")

    doctor = Doctor(
        doctor_id=doctor_id,
        full_name=req.full_name.strip(),
        email=email,
        qualification=req.qualification.strip(),
        specialization=req.specialization.strip(),
        registration_no=req.registration_no.strip(),
        password_hash=auth_service.hash_password(req.password),
    )
    db.add(doctor)
    try:
        db.commit()
    except IntegrityError:  # the same ID/email registered a moment ago, in parallel
        db.rollback()
        raise _error(409, "conflict", "That Doctor ID or email is already registered. Try signing in instead.")
    db.refresh(doctor)

    token, expires = auth_service.create_session(db, doctor, remember=False)
    set_session_cookie(response, request, token, expires, remember=False)
    return profile(doctor)


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    id_key = "id:" + auth_service.normalize_doctor_id(req.doctor_id)
    ip_key = "ip:" + _client_ip(request)
    wait = auth_service.login_by_id.retry_after(id_key) or auth_service.login_by_ip.retry_after(ip_key)
    if wait:
        raise _error(429, "rate_limited", "Too many sign-in attempts. Please wait and try again.",
                     retry_after_seconds=round(wait))

    doctor = auth_service.authenticate(db, req.doctor_id, req.password)
    if doctor is None:
        auth_service.login_by_id.fail(id_key)
        auth_service.login_by_ip.fail(ip_key)
        raise _error(401, "invalid_credentials", "Wrong Doctor ID or password.")

    auth_service.login_by_id.clear(id_key)
    token, expires = auth_service.create_session(db, doctor, remember=req.remember)
    set_session_cookie(response, request, token, expires, remember=req.remember)
    return profile(doctor)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_service.end_session(db, request.cookies.get(SESSION_COOKIE))
    clear_session_cookie(response, request)
    return {"ok": True}


FORGOT_REPLY = {
    "ok": True,
    "message": "If that email belongs to an account, a reset link is on its way. It works for 30 minutes.",
}


def _app_base_url(request: Request) -> str:
    """Where links in emails should point: APP_BASE_URL, else the address the
    browser used (behind ngrok + the Vite proxy: X-Forwarded-Proto + Host)."""
    if settings.APP_BASE_URL:
        return settings.APP_BASE_URL
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    return f"{proto}://{request.headers.get('host', request.url.netloc)}"


def _reset_email(doctor: Doctor, link: str) -> str:
    return (
        f"Dear Dr. {doctor.full_name},\n\n"
        "Someone (hopefully you) asked to reset the password for your AIIMS E-Prescription account.\n"
        f"Open this link within {auth_service.RESET_LINK_MINUTES} minutes to choose a new password:\n\n"
        f"{link}\n\n"
        "If you didn't ask for this, ignore this email; your password stays the same.\n"
    )


@router.post("/forgot")
def forgot_password(
    req: ForgotPasswordRequest, request: Request, background: BackgroundTasks, db: Session = Depends(get_db)
):
    """Always the same reply (and the email goes out in the background), so the
    response never reveals whether an address has an account."""
    email = auth_service.normalize_email(req.email)
    keys = ("forgot:" + email, "forgot-ip:" + _client_ip(request))
    if any(auth_service.forgot_by_key.retry_after(k) for k in keys):
        return FORGOT_REPLY
    for k in keys:
        auth_service.forgot_by_key.fail(k)

    doctor = db.query(Doctor).filter(Doctor.email == email).first() if email else None
    if doctor is not None:
        token = auth_service.create_password_reset(db, doctor)
        link = f"{_app_base_url(request)}/?reset={token}"
        background.add_task(send_email, doctor.email, "Reset your AIIMS E-Prescription password", _reset_email(doctor, link))
    return FORGOT_REPLY


@router.post("/reset")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    if not (auth_service.MIN_PASSWORD_LENGTH <= len(req.password) <= auth_service.MAX_PASSWORD_LENGTH):
        raise _error(400, "validation", f"Please choose a password of at least {auth_service.MIN_PASSWORD_LENGTH} characters.")
    doctor = auth_service.use_password_reset(db, req.token, req.password)
    if doctor is None:
        raise _error(400, "invalid_token", "This reset link is invalid, already used or expired. Ask for a new one.")
    auth_service.login_by_id.clear("id:" + doctor.doctor_id)
    return {"ok": True, "message": "Password changed. Please sign in with your new password."}


@router.get("/me")
def me(doctor: Doctor = Depends(current_doctor)):
    return profile(doctor)
