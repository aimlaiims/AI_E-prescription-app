"""
Speech-to-text only. Deliberately does NOT attempt any medical cleanup here —
that belongs to the extraction step, which has the benefit of seeing the
target field/schema. Keeping this step "dumb" (pure transcription) is what
prevents the whisper layer from silently inventing words.

All failure paths raise UpstreamError with an explicit code, rather than
letting a raw SDK exception (or worse, a malformed/partial API response)
propagate — a rate-limited or degraded API should be visibly rate-limited or
degraded to the caller, never mistaken for a real (if odd) transcript.
"""
import asyncio
import io
import logging
import threading
import time

from ..config import settings
from ..errors import UpstreamError
from . import limits

logger = logging.getLogger(__name__)

# A short vocabulary nudge passed to Whisper as an "initial_prompt" / "prompt".
# This measurably improves recognition of drug names and clinical shorthand
# without changing what was actually said (it only biases decoding, it does
# not rewrite the output).
MEDICAL_VOCAB_HINT = (
    "Patient consultation note. Common terms: mg, ml, tablet, syrup, capsule, "
    "twice daily, thrice daily, at bedtime, after food, before food, "
    "Augmentin, Azithromycin, Paracetamol, Levocetirizine, Pantoprazole, "
    "Ibuprofen, Amoxicillin, BID, TID, OD, HS, PID, fever, cough, cold, "
    "diagnosis, investigation, examination."
)


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm", hint: str | None = None) -> str:
    """Waits its turn in the shared queue (limits.py), then transcribes.
    `hint`: vocabulary nudge for Whisper (vocabulary.whisper_hint); None ->
    the general MEDICAL_VOCAB_HINT."""
    hint = hint or MEDICAL_VOCAB_HINT
    if settings.WHISPER_BACKEND == "groq":
        async with limits.groq.slot():
            async with limits.deadline(settings.TRANSCRIBE_TIMEOUT_SECONDS, "Groq transcription"):
                return await _transcribe_groq(audio_bytes, filename, hint)
    elif settings.WHISPER_BACKEND == "local":
        # Work on this machine (CPU or GPU): in a worker thread, one recording
        # at a time, with the same time limit as a Groq call.
        async with limits.local_whisper.slot():
            async with limits.deadline(settings.TRANSCRIBE_TIMEOUT_SECONDS, "Local transcription"):
                return await asyncio.to_thread(_transcribe_local, audio_bytes, filename, hint)
    else:
        raise UpstreamError(
            f"Unknown WHISPER_BACKEND: {settings.WHISPER_BACKEND}", code="unknown"
        )


def _retry_after_from_headers(response) -> float | None:
    if response is None:
        return None
    val = response.headers.get("retry-after")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


async def _transcribe_groq(audio_bytes: bytes, filename: str, hint: str = MEDICAL_VOCAB_HINT) -> str:
    import groq as groq_sdk

    if not settings.GROQ_API_KEY:
        raise UpstreamError("GROQ_API_KEY is not set in .env", code="auth")

    t0 = time.perf_counter()
    try:
        # One retry for a dropped connection / 5xx; the overall deadline is
        # enforced around this call (limits.deadline).
        async with groq_sdk.AsyncGroq(
            api_key=settings.GROQ_API_KEY, max_retries=1, timeout=settings.TRANSCRIBE_TIMEOUT_SECONDS
        ) as client:
            result = await client.audio.transcriptions.create(
                file=(filename, io.BytesIO(audio_bytes)),
                model="whisper-large-v3",
                prompt=hint,
                response_format="text",
                temperature=0.0,
            )
    except groq_sdk.RateLimitError as e:
        raise UpstreamError(
            "Groq is rate-limiting transcription requests (429). The free tier "
            "caps requests per minute — wait a bit before dictating again.",
            code="rate_limited",
            retry_after=_retry_after_from_headers(e.response) or 20.0,
        ) from e
    except (groq_sdk.AuthenticationError, groq_sdk.PermissionDeniedError) as e:
        raise UpstreamError(
            f"Groq rejected the API key — check GROQ_API_KEY in .env. ({e.message})",
            code="auth",
        ) from e
    except groq_sdk.InternalServerError as e:
        raise UpstreamError(
            "Groq's transcription service is temporarily unavailable (5xx). "
            "Try again shortly.",
            code="unavailable",
        ) from e
    except groq_sdk.APITimeoutError as e:
        raise UpstreamError("Groq transcription timed out.", code="unavailable") from e
    except groq_sdk.APIConnectionError as e:
        raise UpstreamError(
            "Could not reach Groq — check your internet connection.",
            code="unknown",
        ) from e
    except groq_sdk.APIStatusError as e:
        raise UpstreamError(
            f"Groq transcription request failed: {e.message}", code="unknown"
        ) from e
    logger.info(
        "[timing] Groq transcription: %.2fs for %.0f KB audio",
        time.perf_counter() - t0, len(audio_bytes) / 1024,
    )

    # groq SDK returns either a str or an object depending on response_format
    text = result if isinstance(result, str) else getattr(result, "text", "")
    return text.strip()


_model_lock = threading.Lock()
_model = None


def _compute_type() -> str:
    # "auto" lets CTranslate2 pick what the GPU does fastest (float16 on recent
    # cards; older ones such as Pascal lack fast float16).
    if settings.LOCAL_WHISPER_COMPUTE:
        return settings.LOCAL_WHISPER_COMPUTE
    return "int8" if settings.LOCAL_WHISPER_DEVICE == "cpu" else "auto"


def _get_local_model():
    """Loaded once (a large model takes tens of seconds); the lock stops the
    startup preload and a first request from loading it twice."""
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            t0 = time.perf_counter()
            _model = WhisperModel(
                settings.LOCAL_WHISPER_MODEL,
                device=settings.LOCAL_WHISPER_DEVICE,
                compute_type=_compute_type(),
            )
            logger.info(
                "Local Whisper %s loaded on %s (%s) in %.1fs",
                settings.LOCAL_WHISPER_MODEL, settings.LOCAL_WHISPER_DEVICE, _compute_type(),
                time.perf_counter() - t0,
            )
        return _model


def preload_local_model() -> None:
    """Load the model in the background at startup, so the first dictation
    of the day doesn't wait for it. A failure is only logged here; the next
    dictation tries again and shows the doctor a plain message."""
    def load():
        try:
            _get_local_model()
        except Exception as e:  # noqa: BLE001 - logged, retried on first use
            logger.error("Could not load local Whisper model: %s", e)

    threading.Thread(target=load, name="whisper-preload", daemon=True).start()


def _transcribe_local(audio_bytes: bytes, filename: str, hint: str = MEDICAL_VOCAB_HINT) -> str:
    try:
        model = _get_local_model()
    except Exception as e:
        raise UpstreamError(f"Failed to load local Whisper model: {e}", code="unknown") from e

    # Decode from memory. (A NamedTemporaryFile can't be re-opened by name
    # while it is still open on Windows, so passing tmp.name failed there.)
    try:
        segments, _info = model.transcribe(
            io.BytesIO(audio_bytes),
            initial_prompt=hint,
            temperature=0.0,
            vad_filter=True,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        raise UpstreamError(f"Local transcription failed: {e}", code="unknown") from e