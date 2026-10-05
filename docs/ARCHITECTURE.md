# Architecture

Explains **why** the system is shaped this way, not only what the files do.

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
Save ──► POST /api/forms ──► database ──► {pid}          Print ──► standalone HTML window
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

`backend/app/models.py`. Accounts: `doctors` (login `doctor_id` lower-case, name, email,
qualification, specialization, registration no., scrypt hash), `auth_sessions` (token
hash, expiry), `password_resets` (token hash, expiry, used).

**SQLite or PostgreSQL** (`DATABASE_URL`), same code: everything goes through
SQLAlchemy. The schema is owned by **Alembic** (`backend/alembic/versions/`); the app runs
`upgrade head` at startup (`app/migrations.py`). The first migration, `0001_baseline`,
also adopts SQLite databases made before Alembic: it creates only what is missing, so
their records are kept. Changing the schema = edit `models.py`, then
`alembic revision --autogenerate -m "..."`, read the file, test on a copy of a real
database.

Kept the same on both databases:
- Text columns have sizes; PostgreSQL enforces them, SQLite doesn't. Save and sign-up
  check the sizes first (`max_length` in `models.py`) and answer `validation` with a
  "Please shorten …" message instead of a server error.
- SQLite runs with foreign keys on (as PostgreSQL), WAL (reads don't wait for a save)
  and a 5 s busy timeout (two saves at once wait instead of failing).
- Name search uses `lower(...)`, so case-insensitive on both.
- Times are stored as naive UTC. Everything people see is **IST** (`APP_TIMEZONE`,
  `app/clock.py`): the date in a Reference ID, `saved_at` / `created_at` in the API
  (ISO with `+05:30`), and in the browser the form's default date, the date filters,
  the navbar date and the "Printed" time (`dates.js` `APP_TIME_ZONE`) — regardless of the
  timezone the server or the doctor's device is set to.

`backend/tools/`: `backup_database.py` (SQLite backup API + integrity check, or
`pg_dump`; keeps the last N) and `copy_database.py` (to an empty database, sizes checked
first, one transaction, ids and counters carried over, counts verified).

Table `clinical_forms` (plus `doctor_id`, the owner):
`id`, `pid` (unique, `RX-YYYYMMDD-XXXX`, 4 random A-Z0-9), `patient_name`, `date`,
`age`, `gender`, `chief_complaints`, `on_examination`, `diagnosis`, `investigation`,
`medications`, `raw_transcript_log` (all dictation transcripts, `\n---\n` separated),
`created_at`, `updated_at`. `age`/`date` are strings on purpose (free-form input);
`age` holds up to 40 characters ("2 years 6 months").
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
- Parser lives in `frontend/src/voiceCommands.js` (pure functions, no React). Field
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
  FormField.jsx    input with the mic inside it (idle / recording / processing / disabled),
                   missing-field outline + message, read-only when locked
  DictateBar.jsx   big round mic, Space toggle (+ kbd hint on keyboard devices), retry
  ReviewPanel.jsx  diff list, Accept/Discard/Accept all, hands-free toggle
  StatusBanner.jsx saved (Reference ID copy) / error / cooldown — presentational
  Brand.jsx        AppNavbar (logo, date, History), SheetLetterhead (navy band), AppFooter
  SaveButton.jsx   Save prescription / Saving… / Saved (lock-after-save phases)
  RecordsDialog.jsx  past prescriptions: debounced search, date chips + range, paging,
                   loads the full record for the preview, prints (sync window.open)
  RecordsBrowser.jsx presentational dialog: focus trap / return, roving rows, A4 preview
                   scaled to fit, phone-only sticky Print
dates.js           local YYYY-MM-DD helpers + filter-chip date bounds
voiceCommands.js   parseVoiceCommands + FIELD_ALIASES (pure)
pendingUpdates.js  one-pending-per-field merge + pending-applied extraction base (pure)
printTemplate.js   buildPrintHtml(state, pid, {toolbar, letterhead}) -> standalone A4 HTML
messages.js        error code -> plain language
api.js             fetch wrappers, ApiError
fieldSpecs.js      field labels/types/required (MIRRORS backend schemas.py)
useRecorder.js     MediaRecorder start()/stop() -> Blob promise
branding.js        app / institution names, logo URL; logo as a data URI for printing
styles.css         tokens (AIIMS navy + red) + responsive layout
```
Branding (AIIMS Raipur, from the colleague's design): navy navbar with History, a navy
letterhead band with the institute seal at the top of the sheet, a red–navy stripe, a faint
seal watermark (hidden in dark mode: the logo is a JPEG on white), and a ℞ divider between
patient information and the clinical sections. The printed page shows the seal and the
institution name; the doctor's details join once login exists.

Layout (v0 design, ported 2026-09-29): one elevated "paper sheet" — edge-to-edge under
640px with a sticky bottom action bar; a bordered sheet from 640px; wider at 1024px.
Patient fields are two columns from 480px. Required fields are checked in the browser
before Save/Print (red outline + "Please add …"; the banner is derived from the form, so
it clears as fields fill); the backend still validates. There is deliberately no `<form>`
submit — Enter must never save (and so lock) a prescription.

**Print.** `handlePrint` opens the preview window *synchronously* (before any `await`),
saves first if there is no Reference ID, then writes the document. The preview has its
own Print/Close buttons (hidden when printing). Empty optional sections are omitted;
empty medications prints "No medications prescribed." Blank patient fields print "-".
The last 3 medication lines and the signature share one `break-inside: avoid` block, so
the signature is never alone on a page (plain `break-before: avoid` does not hold in
Chrome — checked by rendering PDFs for 1–60 lines). Dates use fixed month names
("28 Sep 2026"); `en-GB` locale formatting gives "Sept" in current Chrome. Letterhead
(clinic / doctor / registration no.) is supported but not configured yet.

## 8. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, whisper_backend}` — the only route that needs no login |
| POST | `/api/auth/signup` | invite code + profile + password → signed in; 403 `invalid_invite`/`signup_disabled`, 409 `conflict`, 400 `validation` |
| POST | `/api/auth/login` | `{doctor_id, password, remember}` → profile + session cookie; 401 `invalid_credentials`, 429 after 5 failures/15 min |
| POST | `/api/auth/logout` | ends the session |
| GET | `/api/auth/me` | `{doctor, institution}`; 401 `unauthenticated` |
| POST | `/api/auth/forgot` | `{email}` → always the same reply; emails a 30-minute single-use link |
| POST | `/api/auth/reset` | `{token, password}`; ends all of that doctor's sessions |
| POST | `/api/transcribe` | multipart `audio` → `{transcript}` |
| POST | `/api/extract` | `{transcript, current_state, target_field?}` → `{updates[], unmatched_transcript_note}` |
| POST | `/api/forms` | `{state, raw_transcript_log}` → `{pid, saved_at}`; 400 `validation` |
| GET | `/api/forms/{pid}` | full record — own records only (another doctor's = 404) |
| GET | `/api/forms` | `?q=` (name or Reference ID, partial, case-insensitive) `&date_from=&date_to=` (YYYY-MM-DD) `&limit=` (≤100, default 50) `&offset=` → `{items[], total, has_more}`, newest visit first |

Every route except `health` and `auth/*` needs a signed-in doctor (401 `unauthenticated`
otherwise); records are filtered to that doctor.

There is **no update or delete endpoint**: a saved prescription is final and the form
locks after save, so a printout always matches the stored record.
The Groq/Gemini SDK calls are blocking; `voice.py` runs them in a worker thread
(`run_in_threadpool`) so a slow request doesn't stall the server.

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

- **Doctor login** (`services/auth.py`, `security.py`, `routers/auth.py`; stdlib only):
  - Passwords: `hashlib.scrypt` with a per-user salt, constant-time compare; an unknown
    Doctor ID costs the same time as a wrong password.
  - Sessions: random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS); only
    its SHA-256 is stored. 12 h, or 30 days with "Keep me signed in".
  - Sign-up needs `SIGNUP_CODE`; login throttled (5 failures per ID per 15 min; 30 per IP).
  - Password reset: emailed single-use link, 30 min, stored hashed; "forgot" never reveals
    whether an email has an account; a reset ends every session of that doctor.
  - CSRF: SameSite=Lax plus a same-origin check on state-changing `/api` requests. The Vite
    proxy must keep the browser's Host (`changeOrigin: false` in `vite.config.js`) —
    otherwise this check, reset links and HTTPS detection break.
  - Each doctor sees only their own prescriptions; records saved before accounts existed
    (no doctor) are visible to nobody.
  - Throttles are in memory (reset on restart; one server only).
- Reference ID = date + 4 random chars from `secrets`: unguessable enough for one clinic,
  and useless without being signed in as the doctor who saved it.
- The database is unencrypted and contains patient identifiers plus raw dictation
  transcripts. Use disk encryption on the server (BitLocker / LUKS, or the cloud
  provider's), and protect backups the same way.
- Login throttles live in the app's memory, so the app runs as ONE server process even
  on PostgreSQL. Several servers would each have their own throttles.
- API keys live only in `backend/.env` and never reach the browser. Keep `.env` out of git.
- Web Speech audio goes to the browser vendor; Whisper audio goes to Groq; transcripts
  go to Google. Confirm this is acceptable for the data you will handle.
