"""services/transcription.py: Groq SDK errors classified into UpstreamError codes."""
from types import SimpleNamespace
from unittest.mock import patch

import groq
import httpx
import pytest

from app.errors import UpstreamError
from app.services import transcription

REQ = httpx.Request("POST", "https://api.groq.com/x")


def fake_groq(result=None, error=None):
    def create(**kwargs):
        fake_groq.kwargs = kwargs
        if error:
            raise error
        return result

    return lambda api_key: SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(create=create))
    )


def run(**kw):
    with patch.object(groq, "Groq", fake_groq(**kw)):
        return transcription._transcribe_groq(b"\x00\x01", "clip.mp4")


def status_error(cls, code, headers=None):
    return cls("m", response=httpx.Response(code, headers=headers or {}, request=REQ), body=None)


def test_text_result_is_stripped_and_filename_and_hint_are_sent():
    assert run(result="  age 34 \n") == "age 34"
    assert fake_groq.kwargs["file"][0] == "clip.mp4"
    assert fake_groq.kwargs["prompt"] == transcription.MEDICAL_VOCAB_HINT
    assert fake_groq.kwargs["temperature"] == 0.0


@pytest.mark.parametrize(
    "error, code, retry_after",
    [
        (status_error(groq.RateLimitError, 429, {"retry-after": "7"}), "rate_limited", 7.0),
        (status_error(groq.RateLimitError, 429), "rate_limited", 20.0),
        (status_error(groq.AuthenticationError, 401), "auth", None),
        (status_error(groq.PermissionDeniedError, 403), "auth", None),
        (status_error(groq.InternalServerError, 500), "unavailable", None),
        (groq.APIConnectionError(request=REQ), "unknown", None),
        (status_error(groq.BadRequestError, 400), "unknown", None),
    ],
    ids=["429-header", "429-default", "401", "403", "500", "connection", "400"],
)
def test_groq_errors_are_classified(error, code, retry_after):
    with pytest.raises(UpstreamError) as e:
        run(error=error)
    assert e.value.code == code
    assert e.value.retry_after == retry_after


def test_missing_key_is_auth(monkeypatch):
    monkeypatch.setattr(transcription.settings, "GROQ_API_KEY", None)
    with pytest.raises(UpstreamError) as e:
        transcription._transcribe_groq(b"\x00", "clip.webm")
    assert e.value.code == "auth"


def test_unknown_backend_is_unknown(monkeypatch):
    monkeypatch.setattr(transcription.settings, "WHISPER_BACKEND", "nope")
    with pytest.raises(UpstreamError) as e:
        transcription.transcribe_audio(b"\x00")
    assert e.value.code == "unknown"
