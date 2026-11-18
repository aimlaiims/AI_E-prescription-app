import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    WHISPER_BACKEND: str = os.getenv("WHISPER_BACKEND", "groq").lower()
    GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")

    LOCAL_WHISPER_MODEL: str = os.getenv("LOCAL_WHISPER_MODEL", "base.en")
    LOCAL_WHISPER_DEVICE: str = os.getenv("LOCAL_WHISPER_DEVICE", "cpu")
    # Empty = int8 on CPU, "auto" on a GPU (the card's fastest supported type).
    LOCAL_WHISPER_COMPUTE: str = os.getenv("LOCAL_WHISPER_COMPUTE", "").strip()

    GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
    # flash-lite for speed; gemini-3.5-flash is the fallback if accuracy suffers.
    EXTRACTION_MODEL: str = os.getenv("EXTRACTION_MODEL", "gemini-3.5-flash-lite")

    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./clinical_forms.db")

    # --- Reports (uploaded files: services/reports.py) ---
    # Folder for the files (the database keeps only their details). Relative
    # = inside the folder the backend runs in. The server sets its own.
    REPORTS_DIR: str = os.getenv("REPORTS_DIR", "reports").strip() or "reports"
    # Largest file accepted, in MB. No limit on how many files a visit has.
    REPORT_MAX_FILE_MB: float = float(os.getenv("REPORT_MAX_FILE_MB", "200"))
    # Uploads are refused when the disk would have less than this left (MB).
    REPORTS_MIN_FREE_MB: float = float(os.getenv("REPORTS_MIN_FREE_MB", "2048"))

    # --- Many users at once (voice) ---
    # Calls in progress at the same time, per provider; more wait in a fair queue.
    GROQ_MAX_IN_FLIGHT: int = int(os.getenv("GROQ_MAX_IN_FLIGHT", "8"))
    GEMINI_MAX_IN_FLIGHT: int = int(os.getenv("GEMINI_MAX_IN_FLIGHT", "8"))
    # Calls started per minute, per provider (0 = no limit here). Set a little below
    # the plan's limit so requests wait briefly here instead of being refused there.
    GROQ_PER_MINUTE: int = int(os.getenv("GROQ_PER_MINUTE", "0"))
    GEMINI_PER_MINUTE: int = int(os.getenv("GEMINI_PER_MINUTE", "0"))
    # Longest wait in the queue before "many people are dictating" is shown.
    VOICE_QUEUE_WAIT_SECONDS: float = float(os.getenv("VOICE_QUEUE_WAIT_SECONDS", "15"))
    # Longest a single call may take once started (includes Gemini's retries).
    TRANSCRIBE_TIMEOUT_SECONDS: float = float(os.getenv("TRANSCRIBE_TIMEOUT_SECONDS", "30"))
    EXTRACT_TIMEOUT_SECONDS: float = float(os.getenv("EXTRACT_TIMEOUT_SECONDS", "30"))
    # Voice requests one signed-in user may have in progress at once.
    VOICE_MAX_PER_USER: int = int(os.getenv("VOICE_MAX_PER_USER", "3"))
    # Largest recording accepted (about 40 minutes of speech at 10 MB).
    MAX_AUDIO_MB: float = float(os.getenv("MAX_AUDIO_MB", "10"))

    # Dates and times people see (and the date in Reference IDs). Stored as UTC.
    APP_TIMEZONE: str = os.getenv("APP_TIMEZONE", "Asia/Kolkata").strip() or "Asia/Kolkata"

    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    ]

    # --- Doctor accounts ---
    # Accounts are added by the department's admin (no self sign-up). The
    # emailed set-password link for a new account works this many days.
    INVITE_LINK_DAYS: int = int(os.getenv("INVITE_LINK_DAYS", "7"))
    # A new doctor registers with a one-time code from the administrator; it
    # works this many hours.
    REGISTRATION_CODE_HOURS: int = int(os.getenv("REGISTRATION_CODE_HOURS", "72"))
    # "Try the demo" button on the sign-in screen (services/demo.py). Off unless
    # set to true; turning it off also ends open demo sessions.
    DEMO_LOGIN: bool = os.getenv("DEMO_LOGIN", "").strip().lower() in ("1", "true", "yes", "on")
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
