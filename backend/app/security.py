"""
Request-side auth: the session cookie, the `current_doctor` dependency every
protected route uses, and a same-origin check for state-changing requests.
"""
from datetime import datetime
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Doctor
from .services import auth as auth_service

SESSION_COOKIE = "cvf_session"

UNAUTHENTICATED = {"error_code": "unauthenticated", "message": "Please sign in."}


def _is_https(request: Request) -> bool:
    # Behind ngrok -> Vite proxy -> here, the browser's scheme arrives as
    # X-Forwarded-Proto (ngrok sets it; the proxy passes it through).
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return proto == "https" or request.url.scheme == "https"


def cookie_secure(request: Request) -> bool:
    if settings.COOKIE_SECURE in ("true", "1", "yes"):
        return True
    if settings.COOKIE_SECURE in ("false", "0", "no"):
        return False
    return _is_https(request)


def set_session_cookie(response: Response, request: Request, token: str, expires: datetime, remember: bool):
    response.set_cookie(
        SESSION_COOKIE,
        token,
        # "Remember me" survives closing the browser; otherwise a browser-session
        # cookie (the server-side expiry still applies either way).
        max_age=int((expires - auth_service._utcnow()).total_seconds()) if remember else None,
        httponly=True,  # not readable from JavaScript
        samesite="lax",
        secure=cookie_secure(request),
        path="/",
    )


def clear_session_cookie(response: Response, request: Request):
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=cookie_secure(request))


def current_doctor(request: Request, db: Session = Depends(get_db)) -> Doctor:
    doctor = auth_service.doctor_for_token(db, request.cookies.get(SESSION_COOKIE))
    if doctor is None:
        raise HTTPException(401, UNAUTHENTICATED)
    return doctor


_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


async def same_origin_guard(request: Request, call_next):
    """CSRF defence on top of SameSite=Lax: a request that changes something
    and carries an Origin header must come from the page's own host. (Through
    the Vite proxy the Host header is the browser's host, so they match.)"""
    if request.method in _UNSAFE and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and origin != "null":
            origin_host = urlsplit(origin).netloc.lower()
            host = request.headers.get("host", "").lower()
            # Also trust origins listed in CORS_ORIGINS, for setups where a
            # proxy rewrites Host (the Vite proxy is set not to).
            trusted = origin.rstrip("/") in {o.rstrip("/") for o in settings.CORS_ORIGINS}
            if origin_host != host and not trusted:
                return JSONResponse(
                    status_code=403,
                    content={"detail": {"error_code": "forbidden", "message": "Request blocked."}},
                )
    return await call_next(request)
