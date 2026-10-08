const BASE = "/api";

// Thrown for any non-2xx API response. `code` lets callers branch behavior
// (e.g. rate_limited -> start a cooldown) instead of guessing from message text.
export class ApiError extends Error {
  constructor(message, code = "unknown", retryAfter = null, detail = null) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
    // The server's whole answer, for errors that carry data (e.g. the
    // `candidates` of "possible_duplicate").
    this.detail = detail;
  }
}

// Fired when any request comes back "unauthenticated" (session ended or
// expired). AuthGate listens and asks the doctor to sign in again — on top of
// the form, so nothing typed or dictated is lost.
export const UNAUTHENTICATED_EVENT = "cvf:unauthenticated";

async function toApiError(res) {
  const err = await parseApiError(res);
  if (err.code === "unauthenticated" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
  }
  return err;
}

async function parseApiError(res) {
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
      detail.retry_after_seconds ?? null,
      detail
    );
  }
  return new ApiError(
    typeof detail === "string" ? detail : `Request failed (${res.status})`,
    "unknown"
  );
}

// The upload's file name must match what the browser actually recorded:
// Safari/iOS records MP4, and the speech-to-text service can reject a file
// whose name says .webm but whose content is MP4.
export function audioFileName(blob) {
  const type = blob?.type || "";
  if (type.includes("mp4")) return "clip.mp4";
  if (type.includes("ogg")) return "clip.ogg";
  if (type.includes("wav")) return "clip.wav";
  return "clip.webm";
}

// `field`: the field whose mic recorded it (its words help speech-to-text);
// none for the whole-visit mic.
export async function transcribeAudio(blob, field) {
  const form = new FormData();
  form.append("audio", blob, audioFileName(blob));
  if (field) form.append("field", field);
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

// `link`: { patientId } (this visit belongs to that patient) or
// { newPatient: true } (register a new patient even though a likely
// duplicate exists). Neither: the server registers a new patient, or answers
// "possible_duplicate" with `detail.candidates` for the doctor to choose.
// Returns { pid, saved_at, patient }.
export async function saveForm(state, rawTranscriptLog, link = {}) {
  const res = await fetch(`${BASE}/forms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state,
      raw_transcript_log: rawTranscriptLog,
      patient_id: link.patientId ?? null,
      new_patient: !!link.newPatient,
    }),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}
// The department's common terms for typing suggestions:
// { diagnoses: [{ name, group, aliases }], medications: [...] }.
export async function getVocabulary() {
  const res = await fetch(`${BASE}/vocabulary`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

// The department's patients: { items } (latest first without q). q: name,
// Patient ID (ENT-000123), OPD No. or city.
export async function findPatients(q = "") {
  const res = await fetch(`${BASE}/patients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

// { patient, visits } — every visit, newest first, as stored.
export async function getPatientHistory(patientId) {
  const res = await fetch(`${BASE}/patients/${encodeURIComponent(patientId)}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

// Past prescriptions of the department: { items, total, has_more }. Params are
// all optional: q (name, Patient ID, OPD No. or Reference ID), date_from / date_to (YYYY-MM-DD), limit, offset.
export async function listForms(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  const res = await fetch(`${BASE}/forms${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export async function getForm(pid) {
  const res = await fetch(`${BASE}/forms/${encodeURIComponent(pid)}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

// --- Doctor accounts. Same-origin requests carry the HttpOnly session cookie
// automatically; JavaScript never sees the token. ---

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  // A failed sign-in is "invalid_credentials", not "unauthenticated", so these
  // never trigger the sign-in-again prompt.
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

// { doctor, department, institution } for the signed-in doctor; throws ApiError
// "unauthenticated" when signed out (does not fire the event: expected at start).
export async function getMe() {
  const res = await fetch(`${BASE}/auth/me`);
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export const login = (email, password, remember) =>
  postJson("/auth/login", { email, password, remember });
export const logout = () => postJson("/auth/logout");
export const forgotPassword = (email) => postJson("/auth/forgot", { email });
export const resetPassword = (token, password) => postJson("/auth/reset", { token, password });

// --- Accounts, for the department's administrator (backend/app/routers/admin.py).
// Errors go through toApiError: an ended session brings up the sign-in box. ---

async function adminRequest(method, path, body) {
  const res = await fetch(`${BASE}/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export const listAccounts = () => adminRequest("GET", "/doctors");
export const addAccount = (fields) => adminRequest("POST", "/doctors", fields);
export const editAccount = (id, fields) => adminRequest("PATCH", `/doctors/${id}`, fields);
export const deactivateAccount = (id) => adminRequest("POST", `/doctors/${id}/deactivate`);
export const activateAccount = (id) => adminRequest("POST", `/doctors/${id}/activate`);
export const sendPasswordLink = (id) => adminRequest("POST", `/doctors/${id}/password-link`);
