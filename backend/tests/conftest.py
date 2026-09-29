"""
Shared test setup. Run from backend/:  python -m pytest

Nothing here talks to Groq or Gemini — every upstream call is replaced with a
fake — and the app uses a throwaway SQLite file, never clinical_forms.db.
"""
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

# Must happen before the app is imported: config/database read these at import.
_DB_DIR = tempfile.mkdtemp(prefix="cvf-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_DB_DIR) / 'test.db'}"
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("GROQ_API_KEY", "test-key")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from google.genai import types  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

EMPTY_STATE = {
    k: ""
    for k in [
        "patient_name", "date", "age", "gender", "chief_complaints",
        "on_examination", "diagnosis", "investigation", "medications",
    ]
}

VALID_STATE = {
    **EMPTY_STATE,
    "patient_name": "Rakesh Bansal",
    "date": "2026-09-28",
    "age": "42",
    "gender": "Male",
    "chief_complaints": "Fever",
    "diagnosis": "Acute bronchitis",
}


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def gemini_response(text, finish_reason=types.FinishReason.STOP, candidates=True):
    """A stand-in for google-genai's GenerateContentResponse."""
    return SimpleNamespace(
        text=text,
        candidates=[SimpleNamespace(finish_reason=finish_reason)] if candidates else None,
    )


class FakeGemini:
    """Fake genai.Client: returns (or raises) the queued results in order."""

    def __init__(self, *results):
        self.results = list(results)
        self.calls = []
        self.models = SimpleNamespace(generate_content=self._generate)

    def _generate(self, **kwargs):
        self.calls.append(kwargs)
        r = self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return r
