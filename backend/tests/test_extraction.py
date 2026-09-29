"""services/extraction.py against a fake Gemini client: parsing, filtering, retries."""
import json
from unittest.mock import patch

import httpx
import pytest
from google.genai import errors as genai_errors
from google.genai import types

from app.errors import UpstreamError
from app.services import extraction
from conftest import EMPTY_STATE, FakeGemini, gemini_response


def run(fake, transcript="age 34", state=EMPTY_STATE, target_field=None):
    with patch.object(extraction, "_get_client", return_value=fake), patch.object(extraction.time, "sleep"):
        return extraction.extract_field_updates(transcript, state, target_field)


def payload(*updates, note=""):
    return json.dumps({"updates": list(updates), "unmatched_transcript_note": note})


def u(field, value, evidence="x"):
    return {"field": field, "new_value": value, "evidence": evidence}


def test_normal_result():
    out = run(FakeGemini(gemini_response(payload(u("age", "34")))))
    assert out["updates"] == [u("age", "34")]


def test_empty_updates_is_a_normal_result_not_an_error():
    out = run(FakeGemini(gemini_response(payload(note="nothing relevant"))))
    assert out["updates"] == []


def test_disallowed_empty_and_malformed_updates_are_dropped():
    result = payload(
        u("age", "34"), u("not_a_field", "x"), u("diagnosis", "   "),
        "junk", {"field": "gender", "new_value": 5},
    )
    out = run(FakeGemini(gemini_response(result)))
    assert out["updates"] == [u("age", "34")]


def test_target_field_restricts_what_can_come_back():
    result = payload(u("age", "34"), u("diagnosis", "Flu"))
    out = run(FakeGemini(gemini_response(result)), target_field="age")
    assert [x["field"] for x in out["updates"]] == ["age"]


@pytest.mark.parametrize(
    "response",
    [
        gemini_response('{"updates": [{"field": "age", "new_va', types.FinishReason.MAX_TOKENS),
        gemini_response(None, types.FinishReason.SAFETY),
        gemini_response(None, candidates=False),  # prompt blocked
        gemini_response("not json"),
        gemini_response("[1, 2]"),
    ],
    ids=["truncated", "safety", "prompt-blocked", "invalid-json", "not-an-object"],
)
def test_bad_model_output_raises_instead_of_looking_like_no_match(response):
    # ROADMAP P0-3: these must reach the doctor as "try again", not "nothing found".
    with pytest.raises(UpstreamError) as e:
        run(FakeGemini(response))
    assert e.value.code == "unknown"


def _client_error(code, headers=None):
    resp = httpx.Response(code, headers=headers or {}, request=httpx.Request("POST", "https://x"))
    return genai_errors.ClientError(code, {"error": {"message": "m", "status": "S"}}, resp)


def _server_error():
    resp = httpx.Response(503, request=httpx.Request("POST", "https://x"))
    return genai_errors.ServerError(503, {"error": {"message": "overloaded", "status": "UNAVAILABLE"}}, resp)


def test_rate_limit_is_not_retried_and_carries_retry_after():
    fake = FakeGemini(_client_error(429, {"retry-after": "12"}))
    with pytest.raises(UpstreamError) as e:
        run(fake)
    assert e.value.code == "rate_limited" and e.value.retry_after == 12.0
    assert len(fake.calls) == 1


def test_rate_limit_without_header_defaults_to_30s():
    with pytest.raises(UpstreamError) as e:
        run(FakeGemini(_client_error(429)))
    assert e.value.retry_after == 30.0


@pytest.mark.parametrize("code", [401, 403])
def test_bad_key_is_auth(code):
    with pytest.raises(UpstreamError) as e:
        run(FakeGemini(_client_error(code)))
    assert e.value.code == "auth"


def test_503_is_retried_then_succeeds():
    fake = FakeGemini(_server_error(), _server_error(), gemini_response(payload(u("age", "34"))))
    assert run(fake)["updates"] == [u("age", "34")]
    assert len(fake.calls) == 3


def test_503_three_times_is_unavailable():
    fake = FakeGemini(_server_error(), _server_error(), _server_error())
    with pytest.raises(UpstreamError) as e:
        run(fake)
    assert e.value.code == "unavailable"


def test_request_uses_forced_schema_and_token_cap():
    fake = FakeGemini(gemini_response(payload()))
    run(fake)
    cfg = fake.calls[0]["config"]
    assert cfg["response_mime_type"] == "application/json"
    assert cfg["response_schema"] is extraction.RESPONSE_SCHEMA
    assert cfg["temperature"] == 0.0 and cfg["max_output_tokens"] == 1024


@pytest.mark.parametrize("reason", [types.FinishReason.MAX_TOKENS, types.FinishReason.SAFETY])
def test_stopped_early_raises_even_if_the_json_happens_to_parse(reason):
    # A cut-off answer can still be valid JSON (e.g. an updates list that lost
    # its last items); finish_reason, not parseability, decides.
    with pytest.raises(UpstreamError):
        run(FakeGemini(gemini_response(payload(u("age", "34")), reason)))
