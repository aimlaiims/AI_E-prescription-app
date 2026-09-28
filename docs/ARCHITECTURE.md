# Architecture

Replaces `HANDOFF.md` (delete that file). Explains **why** the system is shaped this
way, not only what the files do.

## 1. The problem this design answers

The project started over after a first attempt where Whisper + an LLM in one pass
(a) hallucinated field values and (b) silently failed to update fields. Everything below
targets those two failures.

## 2. Pipeline

```
Browser                          FastAPI                               External
───────                          ───────                               ────────
MediaRecorder ─ audio blob ───►  POST /api/transcribe ────────────────► Groq whisper-large-v3
              ◄─ {transcript} ──                                        (vocab hint, temp 0)

              ─ {transcript,     POST /api/extract ───────────────────► Gemini (flash-lite)
                 current_state,  system prompt + current form state     response_schema = JSON
                 target_field} ►  + forced JSON schema                  only; temp 0; capped
              ◄─ {updates[],    ◄ defensive filter (allowed fields,
                  unmatched_note}   non-empty values)

Review panel ── Accept/Discard (click or voice) ──► form state
Save ──► POST /api/forms ──► SQLite ──► {pid}          Print ──► standalone HTML window
```

The two API calls are inherently sequential (extraction needs the transcript), so total
latency ≈ upload + Whisper + network + Gemini. See §9 for measuring it.

### Step 1 — transcribe only
`backend/app/services/transcription.py`. No medical cleanup here, deliberately: a "smart"
transcription layer is where invented words come from. A short vocabulary hint
(`MEDICAL_VOCAB_HINT`) biases decoding toward drug names/dose units without rewriting.
`WHISPER_BACKEND=local` swaps in faster-whisper (less tested).

### Step 2 — extract with a forced schema
`backend/app/services/extraction.py`. Gemini receives the transcript **and the current
form state**, and must answer through `RESPONSE_SCHEMA`:
`{ updates: [{field, new_value, evidence}], unmatched_transcript_note }`.
- Omission is correct: a field not addressed by the transcript is left out. `updates: []`
  is a normal result.
- `evidence` (what in the transcript justifies the value) is shown to the doctor.
- Output is filtered server-side: fields outside the allowed set and empty values are
  dropped, regardless of what the model returned.
- `target_field` (per-field mic) restricts the allowed set to one field — the biggest
  single accuracy lever, since ambiguity is what causes hallucination.

**Combining old and new (prompt rule 4).** `new_value` is always the *full* value the
field should end up with, so the model must merge:
| Doctor says | Result |
|---|---|
| plain restatement ("left ear pain") | replace whole value |
| "add …", "also …", "additionally …" | append as a new line to the existing value |
| "change X to Y", "replace X with Y" | edit only the matching part, keep the rest |
Applies to free-text fields; single-value fields (name, age, gender, date) always replace.
This is model inference, not a deterministic rule — expect misses on unusual phrasing. The
review panel is the safety net. Real failing phrasings are the best material for tuning.

### Step 3 — nothing commits without review
`frontend/src/components/ReviewPanel.jsx`. Each proposed update shows old → new and its
evidence. Accept applies it; Discard drops it. This is what makes an occasional wrong
guess survivable.

## 3. Modes and input methods

| Control | File | Behavior |
|---|---|---|
| Per-field mic | `FormField.jsx` | `target_field` set; one field |
| Whole-visit mic | `DictateBar.jsx` | `target_field = null`; many fields |
| **Space** | `DictateBar.jsx` | toggles the whole-visit mic; ignored while typing in input/textarea/select; ignores key-repeat |
| Retry | `DictateBar.jsx` | if transcription succeeded but extraction failed, re-send the same transcript without re-recording |
| Hands-free confirm | `ReviewPanel.jsx` | browser Web Speech API; see §6 |

## 4. Error handling

One taxonomy, end to end.

```
SDK exception ─► UpstreamError(code, retry_after)        backend/app/errors.py
              ─► HTTP status + {"detail": {"error_code","message","retry_after_seconds"?}}
              ─► ApiError(code, retryAfter)               frontend/src/api.js
              ─► plain-language text                      frontend/src/messages.js
```
| code | HTTP | meaning | UI behavior |
|---|---|---|---|
| `rate_limited` | 429 | quota hit; carries retry-after (defaults: Groq 20s, Gemini 30s) | **app-wide cooldown**: every mic disabled, countdown banner |
| `unavailable` | 503 | provider overloaded; Gemini already retried server-side | error banner; Retry link |
| `auth` | 502 | missing/invalid API key | generic "not set up correctly" message |
| `unknown` | 502 | anything else | generic message |
| `validation` | 400 | required fields missing (`forms.py`) | shown **verbatim** ("Please fill in: …") |

Retry policy (`_generate_with_retry`): 5xx → 3 attempts with sleeps of 1.5s then 3s
(≈4.5s of waiting worst case, plus the three request times). 429 is **not** retried —
retrying a quota error is pointless; the frontend enforces the cooldown instead.
Failure paths never fabricate data. A response that did not finish normally
(`finish_reason` ≠ STOP), was blocked, or is not a JSON object raises
`UpstreamError(code="unknown")`, so the doctor sees a retry option, never a false
"nothing matched". Valid JSON with `updates: []` is still a normal result.

## 5. Data model

`backend/app/models.py` → table `clinical_forms`:
`id`, `pid` (unique, `RX-YYYYMMDD-XXXX`, 4 random A-Z0-9), `patient_name`, `date`,
`age`, `gender`, `chief_complaints`, `on_examination`, `diagnosis`, `investigation`,
`medications`, `raw_transcript_log` (all dictation transcripts, `\n---\n` separated),
`created_at`, `updated_at`. `age`/`date` are strings on purpose (free-form input).
Required to save: patient_name, age, gender, chief_complaints, diagnosis.

Audio is **not** stored: it is held in memory, sent to Groq, discarded. Transcripts are.

## 6. Hands-free confirm (Web Speech API)

Separate from the Whisper/Gemini pipeline: Chrome/Edge `SpeechRecognition`, continuous,
locale from `navigator.language` (matters for Indian English). It only listens while the
toggle is on **and** something is pending.
- Command words: accept `accept|except|confirm|correct` (accept/except are commonly
  confused by recognizers), reject `reject|discard|skip|wrong|cancel|remove`.
- `parseVoiceCommands` extracts **every** command in an utterance, so a run-on
  "accept diagnosis accept medications accept all" is not reduced to one action.
- Recognizer restarts are delayed 350ms (`RESTART_DELAY_MS`); a dot shows whether it is
  actually listening.
- Parser lives in `frontend/src/voiceCommands.js` (pure, tested by `npm test`). Field
  names are matched as whole words against `FIELD_ALIASES` ("exam", "o/e", "sex", "dx"…).
  A bare command acts on the top item, marked **Next** in the panel. A command followed
  by words that name no pending field does **nothing** and shows a notice — never a
  silent fallback to the top item.
- `onresult` parses every final result from `event.resultIndex`, not just the last.
  Merged-result behavior is still a **hypothesis** for the "had to repeat myself" report.

## 7. Frontend structure

```
App.jsx            state: form values, pending[] (each with stable id), transcriptLog,
                   savedPid, error, cooldownUntil, printing/saving. Orchestrates save,
                   print, error routing (handleApiError / handleSaveError).
components/
  FormField.jsx    input + per-field mic (idle / recording / processing spinner)
  DictateBar.jsx   big round mic, Space toggle, status text, transcript retry
  ReviewPanel.jsx  diff list, Accept/Discard/Accept all, hands-free toggle
voiceCommands.js   parseVoiceCommands + FIELD_ALIASES (pure; voiceCommands.test.js)
pendingUpdates.js  one-pending-per-field merge + pending-applied extraction base (pure; tested)
printTemplate.js   buildPrintHtml(state, pid) -> full standalone HTML document
messages.js        error code -> plain language
api.js             fetch wrappers, ApiError
fieldSpecs.js      field labels/types/required (MIRRORS backend schemas.py)
useRecorder.js     MediaRecorder start()/stop() -> Blob promise
styles.css         tokens + responsive layout
```
Layout: one elevated "paper sheet" (prescription-pad look, from the original reference
form) — edge-to-edge under 640px with a sticky bottom action bar; a bordered sheet from
640px; wider at 1024px. Two-column patient fields collapse under 480px.

**Print.** `handlePrint` opens the preview window *synchronously* (before any `await`),
saves first if there is no Reference ID, then writes the document. The preview has its
own Print/Close buttons (hidden when printing). Empty optional sections are omitted;
empty medications prints "No medications prescribed."

## 8. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, whisper_backend}` |
| POST | `/api/transcribe` | multipart `audio` → `{transcript}` |
| POST | `/api/extract` | `{transcript, current_state, target_field?}` → `{updates[], unmatched_transcript_note}` |
| POST | `/api/forms` | `{state, raw_transcript_log}` → `{pid, saved_at}`; 400 `validation` |
| GET | `/api/forms/{pid}` | full record |
| GET | `/api/forms` | latest 100: pid, name, date, diagnosis, created_at |

There is **no update or delete endpoint**: a saved prescription is final and the form
locks (ROADMAP P0-1).
Routes in `voice.py` are `async def` but call synchronous SDK code (ROADMAP P1-1).

## 9. Performance

Measure before optimizing. The backend prints, per call:
`[timing] Groq transcription: 1.8s for 210 KB audio` and
`[timing] Gemini extraction (gemini-3.5-flash-lite): 2.1s`.
If those two sum to far less than the wait you feel, the rest is network — ngrok adds a
relay hop to every request, and the audio upload is the largest payload. Test on plain
localhost to separate the tunnel from the APIs. `gemini-3.5-flash-lite` is the default
because extraction is simple structured parsing and that tier skips extended reasoning.

## 10. Deployment (current: demo)

Run backend + `npm run dev` locally, `ngrok http 5173`. The doctor opens the HTTPS link
on their own device; HTTPS is also what makes microphone and clipboard APIs available
off-localhost. Browser → ngrok URL → Vite proxy `/api` → `localhost:8000`, so requests are
same-origin: no CORS changes needed, and the API stays bound to 127.0.0.1.

A real deployment needs: a reverse proxy (or configurable API base URL — `api.js` hardcodes
relative `/api`), HTTPS, auth, and a persistent host. Not built.

## 11. Security posture (be honest about it)

- No authentication on any endpoint; anyone reaching the server can read/write records.
- PID = date + 4 random chars: fine for lookup by a staff member, guessable if exposed.
- SQLite is unencrypted and contains patient identifiers plus raw dictation transcripts.
- API keys live only in `backend/.env` and never reach the browser. Keep `.env` out of git.
- Web Speech audio goes to the browser vendor; Whisper audio goes to Groq; transcripts
  go to Google. Confirm this is acceptable for the data you will handle.
