from fastapi import APIRouter, UploadFile, File, HTTPException

from ..errors import UpstreamError
from ..schemas import (
    TranscribeResponse,
    ExtractRequest,
    ExtractResponse,
    FieldUpdate,
)
from ..services.transcription import transcribe_audio
from ..services.extraction import extract_field_updates

router = APIRouter(prefix="/api", tags=["voice"])


def _upstream_to_http(e: UpstreamError) -> HTTPException:
    # `detail` as a dict (not a bare string) so the frontend can branch on
    # `error_code` instead of pattern-matching an error message.
    detail = {"error_code": e.code, "message": str(e)}
    if e.retry_after is not None:
        detail["retry_after_seconds"] = e.retry_after
    return HTTPException(status_code=e.http_status(), detail=detail)


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(
            400,
            {
                "error_code": "empty_audio",
                "message": "No audio was captured. Please try dictating again.",
            },
        )
    try:
        text = transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except UpstreamError as e:
        raise _upstream_to_http(e)
    return TranscribeResponse(transcript=text)


@router.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest):
    current_state = req.current_state.model_dump()
    try:
        result = extract_field_updates(
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