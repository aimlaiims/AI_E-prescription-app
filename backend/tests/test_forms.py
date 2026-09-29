import re

from conftest import EMPTY_STATE, VALID_STATE


def save(client, state=VALID_STATE, log=""):
    return client.post("/api/forms", json={"state": state, "raw_transcript_log": log})


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_save_returns_reference_id(client):
    r = save(client)
    assert r.status_code == 200
    assert re.fullmatch(r"RX-\d{8}-[A-Z0-9]{4}", r.json()["pid"])


def test_saved_record_round_trips(client):
    pid = save(client, log="age 42\n---\ndiagnosis acute bronchitis").json()["pid"]
    rec = client.get(f"/api/forms/{pid}").json()
    for k, v in VALID_STATE.items():
        assert rec[k] == v
    assert rec["raw_transcript_log"].startswith("age 42")


def test_reference_ids_are_unique(client):
    pids = {save(client).json()["pid"] for _ in range(20)}
    assert len(pids) == 20


def test_missing_required_fields_are_listed_in_form_order(client):
    r = save(client, state=EMPTY_STATE)
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail["error_code"] == "validation"
    # Labels, in the order the form shows them (not set order).
    assert "Patient name, Age, Gender, Chief complaints, Diagnosis" in detail["message"]


def test_whitespace_only_counts_as_missing(client):
    r = save(client, state={**VALID_STATE, "diagnosis": "   "})
    assert r.status_code == 400
    assert "Diagnosis" in r.json()["detail"]["message"]


def test_unknown_reference_id_is_a_structured_404(client):
    r = client.get("/api/forms/RX-00000000-NOPE")
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "not_found"


def test_list_is_newest_first(client):
    first = save(client, state={**VALID_STATE, "patient_name": "First"}).json()["pid"]
    second = save(client, state={**VALID_STATE, "patient_name": "Second"}).json()["pid"]
    body = client.get("/api/forms").json()
    assert [r["pid"] for r in body["items"][:2]] == [second, first]
    assert set(body["items"][0]) == {"pid", "patient_name", "age", "gender", "date", "diagnosis", "created_at"}
    assert body["total"] == 2 and body["has_more"] is False


def seed(client):
    rows = [("Rakesh Bansal", "2026-09-21"), ("Sunita Reddy", "2026-09-21"),
            ("Gopal Krishnan", "2026-09-19"), ("Priya Sharma", "2026-09-10"), ("rakesh kumar", "2026-08-30")]
    return {name: save(client, state={**VALID_STATE, "patient_name": name, "date": d}).json()["pid"] for name, d in rows}


def names(client, **params):
    return [r["patient_name"] for r in client.get("/api/forms", params=params).json()["items"]]


def test_search_by_name_is_partial_and_case_insensitive(client):
    seed(client)
    assert sorted(names(client, q="RAKESH")) == ["Rakesh Bansal", "rakesh kumar"]
    assert names(client, q="  redd ") == ["Sunita Reddy"]
    assert names(client, q="nobody") == []


def test_search_by_reference_id(client):
    pids = seed(client)
    assert names(client, q=pids["Priya Sharma"].lower()) == ["Priya Sharma"]


def test_search_wildcards_are_literal(client):
    seed(client)
    assert names(client, q="%") == []
    assert names(client, q="_") == []


def test_date_range_and_order(client):
    seed(client)
    assert names(client, date_from="2026-09-19") == ["Sunita Reddy", "Rakesh Bansal", "Gopal Krishnan"]
    assert names(client, date_from="2026-09-10", date_to="2026-09-19") == ["Gopal Krishnan", "Priya Sharma"]
    assert names(client, q="rakesh", date_to="2026-09-01") == ["rakesh kumar"]


def test_bad_date_is_rejected(client):
    assert client.get("/api/forms", params={"date_from": "21/09/2026"}).status_code == 422


def test_paging(client):
    seed(client)
    page1 = client.get("/api/forms", params={"limit": 2}).json()
    page3 = client.get("/api/forms", params={"limit": 2, "offset": 4}).json()
    assert len(page1["items"]) == 2 and page1["total"] == 5 and page1["has_more"] is True
    assert len(page3["items"]) == 1 and page3["has_more"] is False
    assert client.get("/api/forms", params={"limit": 101}).status_code == 422


def test_reference_id_collisions_are_retried_but_bounded(client):
    from unittest.mock import patch
    import app.routers.forms as forms

    # A collision on the first try is retried transparently...
    ids = iter(["RX-20260928-AAAA", "RX-20260928-AAAA", "RX-20260928-BBBB"])
    with patch.object(forms, "_generate_pid", lambda: next(ids)):
        assert save(client).json()["pid"] == "RX-20260928-AAAA"
        assert save(client).json()["pid"] == "RX-20260928-BBBB"
    # ...but endless collisions give up with a retryable error, never hang.
    with patch.object(forms, "_generate_pid", lambda: "RX-20260928-AAAA"):
        r = save(client)
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "unavailable"
