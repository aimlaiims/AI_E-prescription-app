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
`WHISPER_BACKEND=local` swaps in faster-whisper on the server (CPU, or an NVIDIA GPU with
`LOCAL_WHISPER_DEVICE=cuda`): one recording at a time, the same time limit as a Groq call,
the model loaded once in the background at startup (`preload_local_model`), and
`compute_type` "auto" on a GPU (older cards lack fast float16). large-v3 on a Quadro P5000:
about 2 s per 15 s recording.

### Department terms (`services/vocabulary.py`, `app/vocabulary/<CODE>.json`)
- `GET /api/vocabulary` → the doctor's department's lists, for typing suggestions
  (`frontend/src/suggest.js`, `TermSuggestions.jsx`; tapping is the doctor's own input).
- Whisper hint (`whisper_hint`): a field mic gets its own list's hard words (8+ letters,
  abbreviations; Whisper reads only ~224 tokens), the whole-visit mic both in turn; the
  app sends the mic's field with the recording. Other fields keep the general hint.
- Gemini (`prompt_section`): only the dictated field's list, with a rule tested on real
  dictations: the names may only correct how a NAME is written; side, detail, strength,
  form, dose stay as dictated (a bare "write it as listed" dropped "right side" and
  swapped "central perforation" for the listed wording).
- **Unheard-medicine check** (`services/heard_check.py`) — in code, not in the prompt:
  each new medicine line's drug name is compared with the transcript (best match over
  1–4 consecutive words; aliases count). Below 0.6, or marked `[?]` by the model → the
  update gets `check`; the review panel shows it, and Accept all / voice "Accept" skip it.
  Why: with a mis-heard name ("Cinnarizine" → "Tablets and Arisen") Gemini put in a
  different real drug ("Betahistine 25mg") even when told not to. Substitutions scored
  0.40–0.53, genuine corrections 0.60–1.00.

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
| `unavailable` | 503 | provider overloaded (Gemini already retried server-side), or a call passed its deadline | error banner; Retry link |
| `busy` | 503 | OUR queue for the provider is full — many people dictating at once; nothing was sent upstream | "Many people are using voice input right now…" banner |
| `audio_too_long` | 413 | recording over `MAX_AUDIO_MB` | "Please dictate in shorter parts" |
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

`backend/app/models.py`. `departments` (code `ENT`, name "ENT Department" — printed);
accounts: `doctors` (email = sign-in name, lower-case; name, designation, qualification,
specialization, registration no., scrypt hash or "no password yet", `role` doctor/admin,
`is_active`, `approved`, department), `auth_sessions` (token hash, expiry), `password_resets`
(token hash, expiry, used, `purpose` reset/invite), `registration_codes` (scrypt hash of
the code, department, note, expiry, used at/by, revoked at).

**SQLite or PostgreSQL** (`DATABASE_URL`), same code: everything goes through
SQLAlchemy. The schema is owned by **Alembic** (`backend/alembic/versions/`); the app runs
`upgrade head` at startup (`app/migrations.py`). The first migration, `0001_baseline`,
also adopts SQLite databases made before Alembic: it creates only what is missing, so
their records are kept. Changing the schema = edit `models.py`, then
`alembic revision --autogenerate -m "..."`, read the file, test on a copy of a real
database.

Kept the same on both databases:
- Text columns have sizes; PostgreSQL enforces them, SQLite doesn't. Save and account
  details check the sizes first (`max_length` in `models.py`) and answer `validation` with a
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

`patients` (shared by the department): `patient_no` (per department → label
`ENT-000123`), `opd_no` (hospital OPD number, optional, unique per department; NULL when
unknown), name, gender, occupation, city. New numbers: max + 1, the unique constraint
decides a clash (retried). `access_log`: doctor, patient, visit, action
(`view_patient` / `view_visit` / `create_patient` / `create_visit` / `update_patient`),
time — opening or writing a record, not searching.

Table `clinical_forms` = one **visit** (plus `doctor_id`, `department_id`, `patient_id`,
and its own copy of `opd_no`, `occupation`, `city` as they were that day):
`id`, `pid` (unique, `RX-YYYYMMDD-XXXX`, 4 random A-Z0-9), `patient_name`, `date`,
`age`, `gender`, `chief_complaints`, `on_examination`, `diagnosis`, `investigation`,
`medications`, `advice` (free text after the medicines, including the follow-up —
there is no separate follow-up field), `raw_transcript_log` (all dictation transcripts,
`\n---\n` separated),
`created_at`, `updated_at`. `age`/`date` are strings on purpose (free-form input);
`age` holds up to 40 characters ("2 years 6 months").
Required to save: patient_name, age, gender, city, chief_complaints, diagnosis.

Saving a visit (`routers/forms.py`): with `patient_id` → that patient (their record is
updated with real changes only: not case/spacing, never by an empty field; OPD No. may
not belong to another patient → 409 `conflict`). Without → likely duplicates (same OPD
No.; same name, cities agree or one unknown) answer 409 `possible_duplicate` with
`candidates`, nothing saved; `new_patient: true` registers anyway (but never with an OPD
No. that is taken). Migration `0003` made each existing prescription its own patient.

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

Layout (2026-10-19, from the owner's reference design): the doctor's card (navy
letterhead) above the writing pad (a white card with the faint seal), up to 900px wide.
A **voice dock** floats at the bottom on every screen size: the whole-visit mic and its
status (sound-wave bars only while recording), plus Review N when proposals wait; gone
once saved. `.app-frame` keeps room under the content for it. Print / Save sit at the end
of the form (owner's choice, 2026-10-19). Logos show just the round seal (the JPEG has
the motto under it; `object-fit: cover; object-position: top`). Patient
fields: one column on phones, two from 480px, three from 768px (Name | OPD No. | Date);
Diagnosis | Investigation side by side from 768px. Phones sideways (landscape, height
≤ 500px) get a slim navbar, a one-line doctor's card and a slimmer dock. Inter is bundled
(`@fontsource/inter`), no request to Google Fonts. Required fields are checked in the browser
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
| POST | `/api/auth/login` | `{email, password, remember}` → profile + session cookie; 401 `invalid_credentials`, 403 `account_disabled` / `pending_approval` (only with the right password), 429 after 5 failures/15 min |
| POST | `/api/auth/logout` | ends the session |
| GET | `/api/auth/me` | `{doctor (incl. role), department, institution}`; 401 `unauthenticated` |
| POST | `/api/auth/forgot` | `{email}` → always the same reply; emails a 30-minute single-use link |
| POST | `/api/auth/reset` | `{token, password}` — reset link or new account's set-password link; ends all of that doctor's sessions |
| POST | `/api/auth/register/check` | `{code}` → `{ok, department}`; 400 `invalid_code` (one answer for wrong / used / expired / revoked), 429 after 5 wrong codes per IP per 15 min (50 overall) |
| POST | `/api/auth/register` | `{code, full_name, email, password, designation, qualification, specialization, registration_no}` → `{message}`; creates a doctor (never an admin) waiting for approval and spends the code; 400 `invalid_code` / `validation`, 409 `conflict` |
| GET | `/api/admin/departments` | admin only (the one administrator, all departments) |
| GET · POST | `/api/admin/codes` | admin: latest 50 codes with status · new code `{department_id?, note}` → `{code, valid_hours, …}` (the code itself only in this answer) |
| POST | `/api/admin/codes/{id}/revoke` | admin: an open code stops working |
| GET | `/api/admin/doctors` | admin: every account, waiting for approval first |
| POST | `/api/admin/doctors/{id}/approve` · `/reject` | admin: reject only before approval (the account is kept, inactive) |
| PATCH | `/api/admin/doctors/{id}` | admin: edit details (no role field) |
| POST | `/api/admin/doctors/{id}/deactivate` · `/activate` | admin: deactivation ends sessions and unused links; never the administrator |
| POST | `/api/admin/doctors/{id}/password-link` | admin: set-password link (never used) or 24 h reset link; approved, active accounts only |
| POST | `/api/transcribe` | multipart `audio` → `{transcript}` |
| POST | `/api/extract` | `{transcript, current_state, target_field?}` → `{updates[], unmatched_transcript_note}` |
| POST | `/api/forms` | `{state, raw_transcript_log, patient_id?, new_patient?}` → `{pid, saved_at, patient}`; 400 `validation`, 409 `possible_duplicate` (+ `candidates`) / `conflict` |
| GET | `/api/forms/{pid}` | the visit as stored (+ `patient_label`, `doctor_name`) — the department's (another department's = 404); logged |
| GET | `/api/patients` | `?q=` name / Patient ID / OPD No. / city → `{items[]}` (summaries: label, details, visit count, last visit); latest without `q` |
| GET | `/api/patients/{id}` | `{patient, visits[]}` newest first; logged |
| GET | `/api/forms` | the department's; `?q=` (name, Patient ID, OPD No. or Reference ID, partial, case-insensitive) `&date_from=&date_to=` (YYYY-MM-DD) `&limit=` (≤100, default 50) `&offset=` → `{items[], total, has_more}`, newest visit first |

Every route except `health` and `auth/*` needs a signed-in doctor (401 `unauthenticated`
otherwise); records and patients are filtered to that doctor's **department**.

There is **no update or delete endpoint**: a saved prescription is final and the form
locks after save, so a printout always matches the stored record.
Voice calls are **async all the way** (`AsyncGroq`, Gemini `client.aio`): waiting for a
provider, for a retry, or for a turn in the queue holds no thread, so other requests
carry on.

### Many users at once (`services/limits.py`)
- Per provider: at most `*_MAX_IN_FLIGHT` calls in progress; the rest wait **first come,
  first served**. Optional `*_PER_MINUTE` budget, set just below the provider plan's
  limit, so a burst waits briefly here instead of being refused there (429s should then
  be rare; when they happen, the existing cooldown applies).
- Wait capped at `VOICE_QUEUE_WAIT_SECONDS` → `busy`. Each call, once started, has a
  deadline (`*_TIMEOUT_SECONDS`, Gemini's retries included) → `unavailable`.
- At most `VOICE_MAX_PER_USER` voice requests per user at once; recordings over
  `MAX_AUDIO_MB` are refused before anything is sent.
- Local Whisper (CPU): one recording at a time, in a worker thread.
- Saves: the database's unique constraint decides Reference ID clashes (two saves at
  the same instant) → retried with a new ID. Two accounts added with the same email at
  once → 409.
- All of this lives in the app's memory, like the login throttles: **one server
  process**. On one process, async comfortably serves tens of simultaneous users.

## 9. Performance

Measure before optimizing. The backend prints, per call:
`[timing] Groq transcription: 1.8s for 210 KB audio` and
`[timing] Gemini extraction (gemini-3.5-flash-lite): 2.1s`.
If those two sum to far less than the wait you feel, the rest is network — ngrok adds a
relay hop to every request, and the audio upload is the largest payload. Test on plain
localhost to separate the tunnel from the APIs. `gemini-3.5-flash-lite` is the default
because extraction is simple structured parsing and that tier skips extended reasoning.

## 10. Deployment

**Ubuntu server** (`deploy/`, since 2026-11-02): tablet → ngrok (https) → Caddy on
127.0.0.1:8080 (serves `frontend/dist`, proxies `/api` keeping the browser's Host, trusts the
tunnel's X-Forwarded-* headers) → uvicorn on 127.0.0.1:8000 (one worker: the sign-in limits
and the voice queue live in its memory) → PostgreSQL. systemd starts everything at boot; a
timer backs up the database nightly; ufw lets in only SSH. Steps: `deploy/README.md`.

**Windows demo:** run backend + `npm run dev` locally, `ngrok http 5173`. The doctor opens the HTTPS link
on their own device; HTTPS is also what makes microphone and clipboard APIs available
off-localhost. Browser → ngrok URL → Vite proxy `/api` → `localhost:8000`, so requests are
same-origin: no CORS changes needed, and the API stays bound to 127.0.0.1.

A real deployment needs: a reverse proxy (or configurable API base URL — `api.js` hardcodes
relative `/api`), HTTPS, auth, and a persistent host. Not built.

## 11. Security posture (be honest about it)

- **Doctor login** (`services/auth.py`, `security.py`, `routers/auth.py`; stdlib only):
  - Sign in with email + password. Passwords: `hashlib.scrypt` with a per-user salt,
    constant-time compare; an unknown email (or an account whose password isn't set yet)
    costs the same time as a wrong password.
  - Sessions: random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS); only
    its SHA-256 is stored. 12 h, or 30 days with "Keep me signed in".
  - One **administrator** (`role = admin`), made only on the server
    (`tools/create_admin.py`, refuses a second one). Nothing in the API sets a role:
    registration always makes a doctor, the edit route has no role field. The admin role
    is checked on the server (`current_admin`); the administrator sees no prescriptions
    through `/api/admin`, and their own records stay in their own department.
  - New doctors **register with a one-time code**: 8 characters from 31 unambiguous
    letters/digits (~40 bits), stored as an scrypt hash, single use, 72 h
    (`REGISTRATION_CODE_HOURS`), revocable. Wrong codes get one answer whatever the reason
    and are throttled (5 per IP per 15 min, 50 overall), so guessing is not practical.
    The code decides the department. The new account is `approved = false`: it can't sign
    in (told so only after the right password), a session for it opens nothing, and
    "forgot password" ignores it, until the administrator approves it.
  - Deactivated accounts can't sign in (told so only after the right password), lose
    their sessions and unused links at once; their records are kept.
  - Login throttled (5 failures per email per 15 min; 30 per IP).
  - Password reset: emailed single-use link, 30 min, stored hashed; "forgot" never reveals
    whether an email has an account; a reset ends every session of that doctor.
  - CSRF: SameSite=Lax plus a same-origin check on state-changing `/api` requests. The Vite
    proxy must keep the browser's Host (`changeOrigin: false` in `vite.config.js`) —
    otherwise this check, reset links and HTTPS detection break.
  - Patients and prescriptions are shared within the department (client decision,
    2026-10-06) and invisible to other departments (404, like a missing one). Every
    opening or writing of a patient's record is written to `access_log` (who, what, when).
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
