"""
Turns a raw transcript into structured field updates.

Design choices that specifically target the two failure modes described
(hallucinating values / silently not updating fields):

1. Forced JSON schema output via Gemini's native `response_schema` (not
   free-text-then-parse). The model can only emit well-typed updates matching
   the schema below — it cannot ramble, and there is no fragile string-parsing
   step that can misfire.
2. The model is given the CURRENT form state and told explicitly: only emit an
   update for a field if the transcript states a new value for it; if nothing
   in the transcript is relevant, return an empty updates list. This turns
   "field didn't update" into a visible, expected outcome (empty list) rather
   than a silent bug, and stops the model from "helpfully" filling fields with
   guesses.
3. `target_field` mode restricts the schema to a single field when the doctor
   used a per-field mic, which removes almost all of the ambiguity that causes
   hallucination in whole-form dictation.
4. Every update must carry `evidence` — a short quote/paraphrase of what in
   the transcript grounds it. This is shown to the doctor in the review UI,
   so ungrounded guesses are easy to spot and reject.
"""
import json
import logging
import time

from google import genai
from google.genai import errors as genai_errors

from ..config import settings
from ..errors import UpstreamError
from ..schemas import FORM_FIELD_SPECS

logger = logging.getLogger(__name__)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.GEMINI_API_KEY:
            raise UpstreamError("GEMINI_API_KEY is not set in .env", code="auth")
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def _allowed_fields(target_field: str | None) -> list[str]:
    return [target_field] if target_field else list(FORM_FIELD_SPECS.keys())


RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "updates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "description": "form field key"},
                    "new_value": {
                        "type": "string",
                        "description": (
                            "The value to set, cleaned up for spelling/medical "
                            "terminology, but not reworded or embellished beyond "
                            "what was said."
                        ),
                    },
                    "evidence": {
                        "type": "string",
                        "description": "Short paraphrase of the transcript portion that grounds this value.",
                    },
                },
                "required": ["field", "new_value", "evidence"],
            },
        },
        "unmatched_transcript_note": {
            "type": "string",
            "description": (
                "If part of the transcript seemed clinically meaningful but did not "
                "clearly map to any field, briefly note it here so the doctor can see "
                "it was heard but not placed. Empty string if nothing is unmatched."
            ),
        },
    },
    "required": ["updates", "unmatched_transcript_note"],
}


_MAX_RETRIES = 3
_BASE_DELAY_SECONDS = 1.5


def _retry_after_from_genai_error(e) -> float | None:
    response = getattr(e, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    if not headers:
        return None
    val = headers.get("retry-after")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _generate_with_retry(client: genai.Client, **kwargs):
    """
    Gemini's free tier can return 503 UNAVAILABLE under load — this is transient,
    not a code bug, and usually clears within a few seconds, so ServerError gets
    a short retry-with-backoff. A 429 (ClientError) is different: it's a
    per-minute/per-day quota, so retrying immediately is pointless — raise
    "rate_limited" right away with whatever retry-after Gemini provided, and
    let the frontend enforce a real cooldown instead of hammering the API.
    """
    last_exc = None
    for attempt in range(_MAX_RETRIES):
        try:
            return client.models.generate_content(**kwargs)
        except genai_errors.ClientError as e:
            if e.code == 429:
                raise UpstreamError(
                    "Gemini's free-tier rate limit was hit (429). Wait before "
                    "dictating again.",
                    code="rate_limited",
                    retry_after=_retry_after_from_genai_error(e) or 30.0,
                ) from e
            if e.code in (401, 403):
                raise UpstreamError(
                    f"Gemini rejected the API key — check GEMINI_API_KEY in .env. ({e.message})",
                    code="auth",
                ) from e
            raise UpstreamError(
                f"Gemini rejected the request: {e.message}", code="unknown"
            ) from e
        except genai_errors.ServerError as e:
            last_exc = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_DELAY_SECONDS * (2 ** attempt))
                continue
    raise UpstreamError(
        "Gemini is temporarily overloaded (503) after 3 retries. This is common "
        "on the free tier during peak hours — wait a few seconds and try again.",
        code="unavailable",
    ) from last_exc


def extract_field_updates(
    transcript: str, current_state: dict, target_field: str | None = None
) -> dict:

    allowed_fields = _allowed_fields(target_field)
    field_descriptions = "\n".join(
        f"- {k}: {FORM_FIELD_SPECS[k]['label']}"
        + (f" (must be one of: {', '.join(FORM_FIELD_SPECS[k]['options'])})"
           if FORM_FIELD_SPECS[k]["type"] == "enum" else "")
        for k in allowed_fields
    )

    synonym_hint = (
        "Common spoken synonyms you will encounter, mapped to the field they mean: "
        "\"sex\" -> gender; \"DOB\"/\"date of birth\"/\"visit date\" -> date; "
        "\"complaints\"/\"c/o\"/\"presenting with\" -> chief_complaints; "
        "\"O/E\"/\"exam\"/\"findings\" -> on_examination; \"Dx\"/\"impression\" -> diagnosis; "
        "\"Ix\"/\"tests\"/\"labs\" -> investigation; \"Rx\"/\"treatment\"/\"prescribe\" -> medications. "
        "Terse dictation like \"name Aman Verma, age 34, sex male\" should be read as three "
        "separate field statements in sequence, not as one run-on value."
    )

    scope_instruction = (
        f"You may ONLY propose an update for this single field: {target_field}. "
        "The doctor tapped this field's microphone, so the entire transcript is "
        "about this one field's value — do not split it across other fields."
        if target_field
        else (
            "The transcript may mention several fields, or just one, or none clearly. "
            "Only propose updates for fields the transcript actually addresses."
        )
    )

    system_prompt = f"""You are a clinical scribe assistant. You convert a doctor's or \
assistant's spoken dictation (already transcribed by speech-to-text, so it may contain \
minor mis-transcriptions of medical terms/drug names) into structured updates for a \
patient form.

Allowed fields for this task:
{field_descriptions}

Current form state (JSON): {json.dumps(current_state)}

{synonym_hint}

Rules:
1. {scope_instruction}
2. Never invent a value that is not stated or clearly implied by the transcript. If you \
are not confident, leave the field out rather than guessing.
3. Correct obvious speech-to-text errors in medical terminology, drug names, and dosage \
units (e.g. "augmentin six two five mg" -> "Augmentin 625mg"), but do not add clinical \
information that was not said.
4. When a field already has a value (see "Current form state" above) and the field is one \
that can hold multiple pieces of information (chief_complaints, on_examination, diagnosis, \
investigation, medications — NOT patient_name, age, gender, or date, which are single \
values and should always simply be replaced with whatever was newly stated), decide how \
to combine the existing value with the new transcript based on what was actually said: \
   - ADDITION language ("add ...", "also ...", "and also ...", "additionally ...") means \
     append the new content to the EXISTING value (as a new line) rather than replacing it. \
     Example: chief_complaints is currently "Left ear pain"; transcript says "add numbness \
     in left cheek" -> new_value is "Left ear pain\\nNumbness in left cheek", not just the \
     new phrase alone. \
   - CORRECTION language ("change X to Y", "replace X with Y", "actually it's Y not X", \
     "correction, it's Y") means find the specific part of the existing value matching X and \
     replace ONLY that part with Y, leaving the rest of the value — including other lines or \
     other items in a list — completely unchanged. Example: chief_complaints is currently \
     "Right ear pain\\nMild fever"; transcript says "change right ear to left ear" -> \
     new_value is "Left ear pain\\nMild fever" (only the matching part changed, the fever \
     line untouched). This applies even when X is buried inside a multi-line or multi-item \
     value — do not ask the doctor to restate the whole field to fix one part of it. \
   - Plain restatement with NEITHER an addition nor correction cue means the doctor is \
     redictating the field from scratch (most common case) -> new_value is exactly the newly \
     stated content, replacing the old value entirely.
5. For the "medications" field specifically, in addition to rule 4 above: format each \
medicine as its own line, "Tab./Syp./Cap. <name> <strength> — <dose schedule> <duration/\
instructions>", matching the style of existing entries where possible.
6. For "gender", only use one of the allowed options, only if explicitly stated.
7. For "date", only update if a specific date is stated; do not infer today's date.
8. Return ONLY JSON matching the provided schema. No prose, no markdown fences."""

    client = _get_client()
    t0 = time.perf_counter()
    response = _generate_with_retry(
        client,
        model=settings.EXTRACTION_MODEL,
        contents=f'Transcript:\n"""{transcript}"""',
        config={
            "system_instruction": system_prompt,
            "response_mime_type": "application/json",
            "response_schema": RESPONSE_SCHEMA,
            "temperature": 0.0,
            # The schema is small — capping this bounds worst-case latency.
            # See ROADMAP P0-3 before raising/lowering it.
            "max_output_tokens": 1024,
        },
    )
    logger.info(
        "[timing] Gemini extraction (%s): %.2fs",
        settings.EXTRACTION_MODEL, time.perf_counter() - t0,
    )

    try:
        result = json.loads(response.text)
    except (ValueError, TypeError):
        # The doctor sees this identically to "nothing relevant was said" —
        # that's deliberate (there's no different action for them to take
        # either way, and retrying is likely to succeed). Log it so a real
        # model/parsing failure is still visible to whoever operates this.
        logger.warning(
            "Gemini returned unparseable JSON for extraction; treating as "
            "empty result. Raw response (truncated): %r",
            (response.text or "")[:500],
        )
        return {"updates": [], "unmatched_transcript_note": ""}

    # Defensive filtering: never trust the model to have respected scope/allowed
    # fields perfectly. Drop anything outside what was actually permitted.
    result["updates"] = [
        u for u in result.get("updates", [])
        if u.get("field") in allowed_fields
        and u.get("new_value", "").strip() != ""
    ]
    return result