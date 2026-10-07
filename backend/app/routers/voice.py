from fastapi import APIRouter, Depends, UploadFile, File, HTTPException

from ..config import settings
from ..errors import UpstreamError
from ..models import Doctor
from ..schemas import (
    TranscribeResponse,
    ExtractRequest,
    ExtractResponse,
    FieldUpdate,
)
from ..services.transcription import transcribe_audio
from ..services.extraction import extract_field_updates
from ..services import limits
from ..security import current_doctor

# Signed-in doctors only: these calls spend the Groq/Gemini quota.
router = APIRouter(prefix="/api", tags=["voice"], dependencies=[Depends(current_doctor)])


def _upstream_to_http(e: UpstreamError) -> HTTPException:
    # `detail` as a dict (not a bare string) so the frontend can branch on
    # `error_code` instead of pattern-matching an error message.
    detail = {"error_code": e.code, "message": str(e)}
    if e.retry_after is not None:
        detail["retry_after_seconds"] = e.retry_after
    return HTTPException(status_code=e.http_status(), detail=detail)


async def _read_limited(audio: UploadFile) -> bytes:
    """The recording, refused early if it is over MAX_AUDIO_MB (never read whole)."""
    limit = int(settings.MAX_AUDIO_MB * 1024 * 1024)
    data = await audio.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            413,
            {
                "error_code": "audio_too_long",
                "message": "That recording is too long. Please dictate in shorter parts.",
            },
        )
    return data


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...), doctor: Doctor = Depends(current_doctor)):
    audio_bytes = await _read_limited(audio)
    if not audio_bytes:
        raise HTTPException(
            400,
            {
                "error_code": "empty_audio",
                "message": "No audio was captured. Please try dictating again.",
            },
        )
    try:
        # Async all the way down: waiting for Groq/Gemini (or for a turn in the
        # queue, services/limits.py) holds no thread, so other requests go on.
        with limits.per_user.hold(doctor.id):
            text = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except UpstreamError as e:
        raise _upstream_to_http(e)
    return TranscribeResponse(transcript=text)


@router.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest, doctor: Doctor = Depends(current_doctor)):
    current_state = req.current_state.model_dump()
    try:
        with limits.per_user.hold(doctor.id):
            result = await extract_field_updates(
                transcript=req.transcript,
                current_state=current_state,
                target_field=req.target_field,
            )
    except UpstreamError as e:
        raise _upstream_to_http(e)

    updates = [
        FieldUpdate(
            field=u["field"],
            old_value=current_state.get(u["field"], ""),
            new_value=u["new_value"],
            evidence=u.get("evidence", ""),
        )
        for u in result.get("updates", [])
    ]
    return ExtractResponse(
        updates=updates,
        unmatched_transcript_note=result.get("unmatched_transcript_note", ""),
    )