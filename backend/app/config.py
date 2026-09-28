import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    WHISPER_BACKEND: str = os.getenv("WHISPER_BACKEND", "groq").lower()
    GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")

    LOCAL_WHISPER_MODEL: str = os.getenv("LOCAL_WHISPER_MODEL", "base.en")
    LOCAL_WHISPER_DEVICE: str = os.getenv("LOCAL_WHISPER_DEVICE", "cpu")

    # ANTHROPIC_API_KEY: str | None = os.getenv("ANTHROPIC_API_KEY")
    # EXTRACTION_MODEL: str = os.getenv("EXTRACTION_MODEL", "claude-sonnet-4-6")
    #Gemini LLM
    GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
    EXTRACTION_MODEL: str = os.getenv("EXTRACTION_MODEL", "gemini-3.5-flash")

    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./clinical_forms.db")

    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    ]


settings = Settings()
