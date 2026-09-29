"""HTTP layer of /api/transcribe and /api/extract: error taxonomy, filtering."""
import threading
import time
from unittest.mock import patch

import pytest

import app.routers.voice as voice
from app.errors import UpstreamError
from conftest import EMPTY_STATE


def extract(client, transcript="age 34", state=EMPTY_STATE, target_field=None):
    return client.post(
        "/api/extract",
        json={"transcript": transcript, "current_state": state, "target_field": target_field},
    )


def test_empty_audio_is_rejected_before_any_upstream_call(client):
    with patch.object(voice, "transcribe_audio") as t:
        r = client.post("/api/transcribe", files={"audio": ("clip.webm", b"", "audio/webm")})
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "empty_audio"
    t.assert_not_called()


def test_transcribe_passes_the_filename_through(client):
    # The upload is named after the recorded type (clip.mp4 on iPhone).
    with patch.object(voice, "transcribe_audio", return_value="age 34") as t:
        r = client.post("/api/transcribe", files={"audio": ("clip.mp4", b"\x00\x01", "audio/mp4")})
    assert r.status_code == 200 and r.json() == {"transcript": "age 34"}
    assert t.call_args.kwargs["filename"] == "clip.mp4"


@pytest.mark.parametrize(
    "code, retry_after, status",
    [("rate_limited", 15.0, 429), ("unavailable", None, 503), ("auth", None, 502), ("unknown", None, 502)],
)
def test_upstream_errors_become_structured_http_errors(client, code, retry_after, status):
    err = UpstreamError("internal detail", code=code, retry_after=retry_after)
    with patch.object(voice, "extract_field_updates", side_effect=err):
        r = extract(client)
    assert r.status_code == status
    detail = r.json()["detail"]
    assert detail["error_code"] == code
    assert detail.get("retry_after_seconds") == retry_after


def test_transcribe_upstream_error_is_structured_too(client):
    err = UpstreamError("x", code="rate_limited", retry_after=20.0)
    with patch.object(voice, "transcribe_audio", side_effect=err):
        r = client.post("/api/transcribe", files={"audio": ("clip.webm", b"\x00", "audio/webm")})
    assert r.status_code == 429
    assert r.json()["detail"]["retry_after_seconds"] == 20.0


def test_unknown_target_field_is_422_not_500(client):
    with patch.object(voice, "extract_field_updates") as x:
        r = extract(client, target_field="not_a_field")
    assert r.status_code == 422
    x.assert_not_called()


def test_old_value_comes_from_the_current_state(client):
    result = {"updates": [{"field": "age", "new_value": "35", "evidence": "age 35"}], "unmatched_transcript_note": ""}
    with patch.object(voice, "extract_field_updates", return_value=result):
        r = extract(client, state={**EMPTY_STATE, "age": "34"}, target_field="age")
    assert r.json()["updates"] == [{"field": "age", "old_value": "34", "new_value": "35", "evidence": "age 35"}]


def test_a_slow_upstream_call_does_not_block_other_requests(client):
    # ROADMAP P1-1: the SDK calls are blocking; they must run off the event loop.
    def slow(**_):
        time.sleep(1.5)
        return {"updates": [], "unmatched_transcript_note": ""}

    with patch.object(voice, "extract_field_updates", side_effect=slow):
        t = threading.Thread(target=lambda: extract(client))
        t.start()
        time.sleep(0.2)
        t0 = time.perf_counter()
        assert client.get("/api/health").status_code == 200
        elapsed = time.perf_counter() - t0
        t.join()
    assert elapsed < 0.5
