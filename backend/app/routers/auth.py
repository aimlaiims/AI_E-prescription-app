import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Doctor, max_length
from ..schemas import (
    ForgotPasswordRequest, LoginRequest, RegistrationCheck, RegistrationRequest, ResetPasswordRequest,
)
from ..security import SESSION_COOKIE, clear_session_cookie, current_doctor, set_session_cookie
from ..services import auth as auth_service
from ..services import registration
from ..services.email import send_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
APP_NAME = "AIIMS E-Prescription"


def _error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message, **extra})


def profile(doctor: Doctor) -> dict:
    """What the app needs about the signed-in doctor (letterhead, navbar)."""
    return {
        "doctor": {
            "email": doctor.email,
            "full_name": doctor.full_name,
            "qualification": doctor.qualification,
            "specialization": doctor.specialization,
            "registration_no": doctor.registration_no,
            "role": doctor.role,
            "designation": doctor.designation or "",
        },
        "department": (
            {"code": doctor.department.code, "name": doctor.department.name} if doctor.department else None
        ),
        "institution": settings.INSTITUTION_NAME,
    }


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def app_base_url(request: Request) -> str:
    """Where links in emails should point: APP_BASE_URL, else the address the
    browser used (behind ngrok + the Vite proxy: X-Forwarded-Proto + Host)."""
    if settings.APP_BASE_URL:
        return settings.APP_BASE_URL.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    return f"{proto}://{request.headers.get('host', request.url.netloc)}"


def check_password_length(password: str) -> None:
    if not (auth_service.MIN_PASSWORD_LENGTH <= len(password) <= auth_service.MAX_PASSWORD_LENGTH):
        raise _error(400, "validation", f"Please choose a password of at least {auth_service.MIN_PASSWORD_LENGTH} characters.")


def email_problem(email: str) -> str | None:
    """What's wrong with an (already normalised) email address, or None."""
    if not EMAIL.match(email):
        return "a valid email address"
    limit = max_length(Doctor, "email")
    if len(email) > limit:
        return f"an email address of at most {limit} characters"
    return None


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    email_key = "email:" + auth_service.normalize_email(req.email)
    ip_key = "ip:" + _client_ip(request)
    wait = auth_service.login_by_email.retry_after(email_key) or auth_service.login_by_ip.retry_after(ip_key)
    if wait:
        raise _error(429, "rate_limited", "Too many sign-in attempts. Please wait and try again.",
                     retry_after_seconds=round(wait))

    doctor = auth_service.authenticate(db, req.email, req.password)
    if doctor is None:
        auth_service.login_by_email.fail(email_key)
        auth_service.login_by_ip.fail(ip_key)
        raise _error(401, "invalid_credentials", "Wrong email or password.")
    if not doctor.is_active:
        # Only said to someone who knows the password.
        raise _error(403, "account_disabled",
                     "This account has been deactivated. Please contact your department's administrator.")
    if not doctor.approved:
        raise _error(403, "pending_approval",
                     "Your registration is waiting for the administrator's approval. You can sign in once it is approved.")

    auth_service.login_by_email.clear(email_key)
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


def reset_email(doctor: Doctor, link: str, valid_for: str) -> str:
    return (
        f"Dear Dr. {doctor.full_name},\n\n"
        f"A password reset was requested for your {APP_NAME} account.\n"
        f"Open this link within {valid_for} to choose a new password:\n\n"
        f"{link}\n\n"
        "If you didn't ask for this, ignore this email; your password stays the same.\n"
    )


def invite_email(doctor: Doctor, link: str, department: str) -> str:
    return (
        f"Dear Dr. {doctor.full_name},\n\n"
        f"An account has been created for you on {APP_NAME} ({department}).\n"
        f"Open this link within {settings.INVITE_LINK_DAYS} days to choose your password:\n\n"
        f"{link}\n\n"
        f"Then sign in with this email address: {doctor.email}\n"
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

    doctor = auth_service.find_doctor(db, email) if email else None
    if doctor is not None and doctor.is_active and doctor.approved:
        token = auth_service.create_password_reset(db, doctor)
        link = f"{app_base_url(request)}/?reset={token}"
        background.add_task(send_email, doctor.email, f"Reset your {APP_NAME} password",
                            reset_email(doctor, link, f"{auth_service.RESET_LINK_MINUTES} minutes"))
    return FORGOT_REPLY


@router.post("/reset")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """A reset link, or a new account's set-password link."""
    check_password_length(req.password)
    doctor = auth_service.use_password_reset(db, req.token, req.password)
    if doctor is None:
        raise _error(400, "invalid_token",
                     "This link is invalid, already used or expired. Ask your administrator for a new one.")
    auth_service.login_by_email.clear("email:" + doctor.email)
    return {"ok": True, "message": "Password saved. Sign in with your email and new password."}


@router.get("/me")
def me(doctor: Doctor = Depends(current_doctor)):
    return profile(doctor)


# --- Registration with a one-time code (services/registration.py) -------------

INVALID_CODE = "That code isn't valid. Check it with the administrator: codes work once and expire after a few days."

# Profile fields with a length limit in the database.
PROFILE_LABELS = {
    "full_name": "a full name",
    "designation": "a designation",
    "qualification": "a qualification",
    "specialization": "a specialization",
    "registration_no": "a registration number",
}


def _open_code(db: Session, request: Request, code: str):
    """The open code typed, or a 400 / 429. Wrong guesses are limited per
    address and overall."""
    ip_key = "reg-ip:" + _client_ip(request)
    wait = registration.check_by_ip.retry_after(ip_key) or registration.check_overall.retry_after("all")
    if wait:
        raise _error(429, "rate_limited", "Too many attempts. Please wait and try again.",
                     retry_after_seconds=round(wait))
    row = registration.find_open(db, code)
    if row is None:
        registration.check_by_ip.fail(ip_key)
        registration.check_overall.fail("all")
        raise _error(400, "invalid_code", INVALID_CODE)
    return row


@router.post("/register/check")
def check_registration_code(req: RegistrationCheck, request: Request, db: Session = Depends(get_db)):
    """Step 1: is the code good? (Says which department it registers for.)"""
    row = _open_code(db, request, req.code)
    return {"ok": True, "department": row.department.name}


@router.post("/register")
def register(req: RegistrationRequest, request: Request, db: Session = Depends(get_db)):
    """Step 2: create the doctor's account (always a plain doctor, in the
    code's department), waiting for the administrator's approval."""
    row = _open_code(db, request, req.code)
    email = auth_service.normalize_email(req.email)
    problems = []
    if not req.full_name.strip():
        problems.append("your full name")
    if problem := email_problem(email):
        problems.append(problem)
    for field, label in PROFILE_LABELS.items():
        limit = max_length(Doctor, field)
        if len(getattr(req, field).strip()) > limit:
            problems.append(f"{label} of at most {limit} characters")
    if not (auth_service.MIN_PASSWORD_LENGTH <= len(req.password) <= auth_service.MAX_PASSWORD_LENGTH):
        problems.append(f"a password of at least {auth_service.MIN_PASSWORD_LENGTH} characters")
    if problems:
        raise _error(400, "validation", "Please enter " + ", ".join(problems) + ".")
    if auth_service.find_doctor(db, email):
        raise _error(409, "conflict", "An account with this email already exists. Try signing in instead.")

    doctor = Doctor(
        full_name=req.full_name.strip(), email=email, role="doctor", approved=False, is_active=True,
        department_id=row.department_id, designation=req.designation.strip(),
        qualification=req.qualification.strip(), specialization=req.specialization.strip(),
        registration_no=req.registration_no.strip(), password_hash=auth_service.hash_password(req.password),
    )
    db.add(doctor)
    try:
        db.flush()
    except IntegrityError:  # the same email registered a moment ago, in parallel
        db.rollback()
        raise _error(409, "conflict", "An account with this email already exists. Try signing in instead.")
    row.used_at = auth_service._utcnow()
    row.used_by = doctor.id
    db.commit()
    registration.check_by_ip.clear("reg-ip:" + _client_ip(request))
    return {"ok": True, "message": "Registration sent. You can sign in once the administrator approves it."}
