import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    WHISPER_BACKEND: str = os.getenv("WHISPER_BACKEND", "groq").lower()
    GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")

    LOCAL_WHISPER_MODEL: str = os.getenv("LOCAL_WHISPER_MODEL", "base.en")
    LOCAL_WHISPER_DEVICE: str = os.getenv("LOCAL_WHISPER_DEVICE", "cpu")

    GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
    # flash-lite for speed; gemini-3.5-flash is the fallback if accuracy suffers.
    EXTRACTION_MODEL: str = os.getenv("EXTRACTION_MODEL", "gemini-3.5-flash-lite")

    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./clinical_forms.db")

    # Dates and times people see (and the date in Reference IDs). Stored as UTC.
    APP_TIMEZONE: str = os.getenv("APP_TIMEZONE", "Asia/Kolkata").strip() or "Asia/Kolkata"

    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    ]

    # --- Doctor accounts ---
    # Sign-up needs this invite code. Unset/empty -> sign-up is disabled.
    SIGNUP_CODE: str = os.getenv("SIGNUP_CODE", "").strip()
    SESSION_HOURS: int = int(os.getenv("SESSION_HOURS", "12"))
    REMEMBER_DAYS: int = int(os.getenv("REMEMBER_DAYS", "30"))
    # "auto": Secure cookie when the page is served over HTTPS (e.g. ngrok),
    # not on plain-http localhost. "true"/"false" force it.
    COOKIE_SECURE: str = os.getenv("COOKIE_SECURE", "auto").strip().lower()
    INSTITUTION_NAME: str = os.getenv(
        "INSTITUTION_NAME", "All India Institute of Medical Sciences, Raipur"
    )

    # --- Password-reset email (SMTP) ---
    # Not configured -> the reset link is written to the backend log instead.
    SMTP_HOST: str = os.getenv("SMTP_HOST", "").strip()
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "").strip()
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "").strip()
    # Public address of the app, for links in emails (e.g. the ngrok URL).
    # Empty -> taken from the request that asked for the reset.
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "").strip().rstrip("/")


settings = Settings()
