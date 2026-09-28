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
import io
import logging
import tempfile
import time
from functools import lru_cache

from ..config import settings
from ..errors import UpstreamError

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


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    if settings.WHISPER_BACKEND == "groq":
        return _transcribe_groq(audio_bytes, filename)
    elif settings.WHISPER_BACKEND == "local":
        return _transcribe_local(audio_bytes, filename)
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


def _transcribe_groq(audio_bytes: bytes, filename: str) -> str:
    import groq as groq_sdk
    from groq import Groq

    if not settings.GROQ_API_KEY:
        raise UpstreamError("GROQ_API_KEY is not set in .env", code="auth")

    client = Groq(api_key=settings.GROQ_API_KEY)
    t0 = time.perf_counter()
    try:
        result = client.audio.transcriptions.create(
            file=(filename, io.BytesIO(audio_bytes)),
            model="whisper-large-v3",
            prompt=MEDICAL_VOCAB_HINT,
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


@lru_cache(maxsize=1)
def _get_local_model():
    from faster_whisper import WhisperModel

    return WhisperModel(
        settings.LOCAL_WHISPER_MODEL,
        device=settings.LOCAL_WHISPER_DEVICE,
        compute_type="int8" if settings.LOCAL_WHISPER_DEVICE == "cpu" else "float16",
    )


def _transcribe_local(audio_bytes: bytes, filename: str) -> str:
    try:
        model = _get_local_model()
    except Exception as e:
        raise UpstreamError(f"Failed to load local Whisper model: {e}", code="unknown") from e

    suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            segments, _info = model.transcribe(
                tmp.name,
                initial_prompt=MEDICAL_VOCAB_HINT,
                temperature=0.0,
                vad_filter=True,
            )
            return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        raise UpstreamError(f"Local transcription failed: {e}", code="unknown") from e