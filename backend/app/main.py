import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import migrations
from .config import settings
from .database import engine
from .routers import admin, auth, voice, forms, patients, vocabulary
from .security import same_origin_guard
from .services import transcription

logging.basicConfig(level=logging.INFO)

# Bring the database schema up to date (Alembic; see migrations.py).
migrations.run(engine)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.WHISPER_BACKEND == "local":
        transcription.preload_local_model()
    yield


app = FastAPI(title="Clinical Voice Form API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(same_origin_guard)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(patients.router)
app.include_router(vocabulary.router)
app.include_router(voice.router)
app.include_router(forms.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "whisper_backend": settings.WHISPER_BACKEND}
