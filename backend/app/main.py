import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import migrations
from .config import settings
from .database import engine
from .routers import auth, voice, forms
from .security import same_origin_guard

logging.basicConfig(level=logging.INFO)

# Create tables and apply idempotent schema steps (see migrations.py).
migrations.run(engine)

app = FastAPI(title="Clinical Voice Form API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(same_origin_guard)

app.include_router(auth.router)
app.include_router(voice.router)
app.include_router(forms.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "whisper_backend": settings.WHISPER_BACKEND}
