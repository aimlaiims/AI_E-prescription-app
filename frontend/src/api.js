const BASE = "/api";

// Thrown for any non-2xx API response. `code` lets callers branch behavior
// (e.g. rate_limited -> start a cooldown) instead of guessing from message text.
export class ApiError extends Error {
  constructor(message, code = "unknown", retryAfter = null) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function toApiError(res) {
  let detail = null;
  try {
    const body = await res.json();
    detail = body?.detail;
  } catch {
    /* response wasn't JSON — fall through to the generic case below */
  }
  if (detail && typeof detail === "object") {
    return new ApiError(
      detail.message || `Request failed (${res.status})`,
      detail.error_code || "unknown",
      detail.retry_after_seconds ?? null
    );
  }
  return new ApiError(
    typeof detail === "string" ? detail : `Request failed (${res.status})`,
    "unknown"
  );
}

export async function transcribeAudio(blob) {
  const form = new FormData();
  form.append("audio", blob, "clip.webm");
  const res = await fetch(`${BASE}/transcribe`, { method: "POST", body: form });
  if (!res.ok) throw await toApiError(res);
  const data = await res.json();
  return data.transcript;
}

export async function extractFields(transcript, currentState, targetField = null) {
  const res = await fetch(`${BASE}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      current_state: currentState,
      target_field: targetField,
    }),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export async function saveForm(state, rawTranscriptLog) {
  const res = await fetch(`${BASE}/forms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, raw_transcript_log: rawTranscriptLog }),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}