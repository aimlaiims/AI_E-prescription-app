import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .database import Base, engine
from .routers import voice, forms

logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)
# Indexes added after the table first existed (see models.py). Idempotent.
with engine.begin() as conn:
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clinical_forms_patient_name ON clinical_forms (patient_name)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_clinical_forms_date ON clinical_forms (date)"))

app = FastAPI(title="Clinical Voice Form API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice.router)
app.include_router(forms.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "whisper_backend": settings.WHISPER_BACKEND}
