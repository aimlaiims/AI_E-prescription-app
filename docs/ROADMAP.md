# Roadmap, open issues, suggestions

`node scripts/verify-changes.mjs` reports each issue below as **OPEN** (the bug pattern was
found), **fixed** (positive evidence of the fix was found) or **unknown** (neither — look by
hand). "Not found" is never treated as "fixed". Confirmed = reproduced or read
in the code. Hypothesis = plausible, not yet demonstrated.

Priority: **P0** wrong or unsafe behavior, fix before any further demo · **P1** should fix
before anyone depends on it · **P2** required before real patient data · **P3** improvements.

---

## P0 — confirmed bugs

### P0-1  Editing after Save diverges from the stored record
> **Fixed 2026-09-28 — lock after save** (the owner's choice; no update endpoint for now).
> After save every field is read-only, mics and the review panel are removed, and the only
> way to change anything is a new prescription. Save/Print is blocked while proposals are
> still pending, so none are silently left out. Original analysis kept below for history.

**Confirmed by code.** After save, `Save` disables permanently. `Print` reuses the old
Reference ID but prints the *current* (possibly edited) form. The database keeps the old
values. Paper and record silently disagree. There is also no way to correct a saved record.

Fix (recommended — doctors will fix typos after saving):
1. Backend: `PUT /api/forms/{pid}` — same validation as create, updates all fields and
   `updated_at` (column already exists, so no migration), appends to `raw_transcript_log`.
   404 if unknown.
2. Frontend: keep `savedSnapshot` (the state as last saved); `dirty = JSON.stringify(state)
   !== savedSnapshot`. When `savedPid && dirty` the primary button becomes **Update record**;
   when `savedPid && !dirty` it shows a disabled "Saved ✓".
3. Print: if `dirty`, update first (same flow as save-first today). The printed page must
   always equal what is stored. Show "Last saved <time>" on the print footer.
4. Show a small "Unsaved changes" indicator whenever `dirty`.
Alternative (cheaper): lock the form after save with a visible "Record finalized — start a
new prescription to change it". Pick one; do not leave the current state.
Acceptance: save → edit diagnosis → Print → stored record and printout match.

### P0-2  Voice targeting acts on the wrong item  (this is the "false accept")
> **Fixed 2026-09-28 (a, b, c, e; 1–5 below).** Parser moved to `frontend/src/voiceCommands.js`
> with aliases and whole-word matching; an unrecognised target does nothing and shows a
> notice; the top item is marked "Next"; `onresult` reads from `event.resultIndex`.
> `npm test` (20 cases, incl. the table below). **(d) is still unverified/open.**

**Confirmed** by running the shipped parser (pending: name, age, gender, exam, diagnosis):
| said | expected | got |
|---|---|---|
| `accept age` | age | **patient_name** (top item) |
| `accept exam` | on_examination | **patient_name** |
| `accept dignosis` (misheard) | none / ask | **patient_name** |
| `accept gender` / `accept examination` | correct | correct |

Causes, all in `parseVoiceCommands` (`ReviewPanel.jsx`):
- (a) Label words shorter than 4 characters are ignored (`w.length > 3`) → "Age" can never be named.
- (b) Matching is `phrase.includes(labelWord)`, so "exam" never matches "examination"; there
  are no aliases even though the extraction prompt already has a synonym list.
- (c) When a field name is spoken but nothing matches, it **falls back to the first item**.
  Accepting the wrong medical field silently is the worst failure this feature can have.
- (d) Unverified: pressing Space with a *button* focused (e.g. after clicking the mic or
  Print) may both toggle dictation and activate the button; `DictateBar` only excludes
  input/textarea/select. Test it (docs/TESTING.md §3); if it double-fires, handle Space on
  keyup with `preventDefault` on both events, or blur the button after click.
- (e) `onresult` reads only `event.results[event.results.length - 1]`. Read from
  `event.resultIndex` to the end, so multiple results in one event are all parsed.

Fix:
1. Extract the parser to `frontend/src/voiceCommands.js` (pure function, no React) so it can
   be unit-tested.
2. Alias map per field: name→`patient name|name|patient`, age→`age`,
   gender→`gender|sex`, date→`date`, chief_complaints→`complaint|complaints|chief`,
   on_examination→`exam|examination|o e`, diagnosis→`diagnosis|dx`,
   investigation→`investigation|tests|labs`, medications→`medication|medications|medicine|rx`.
   Match on whole tokens, not substrings.
3. Bare command (`accept`, `discard`, nothing after it) → act on the top item. Command
   **followed by words that are not filler** (`the|this|that|it|one|please|now`) and match no
   alias → **do nothing** and show "Didn't catch which item — say the field name or tap
   Accept." Never fall back silently.
4. Visually mark the top pending item as "current" so bare-command behavior is visible.
5. Vitest cases: the table above, chained commands, `accept all`, reject variants, filler.
Acceptance: `accept age` accepts age; a garbled name accepts nothing and says so.

### P0-3  Extraction failures look like "nothing matched"
> **Fixed 2026-09-28.** `finish_reason` other than STOP (e.g. MAX_TOKENS, SAFETY), no
> candidates, or JSON that does not parse to an object now raise `UpstreamError(code="unknown")`
> → error banner + retry link. `finish_reason` is logged on the `[timing]` line.

**Confirmed by code.** `extract_field_updates` catches `ValueError/TypeError` from
`json.loads(response.text)` and returns `updates: []`. Truncation, an empty response, or a
safety block are therefore indistinguishable from "the doctor said nothing relevant", and
the doctor is told to rephrase.
Risk amplifier: `max_output_tokens: 1024`. On thinking-capable models, reasoning tokens
**may** count toward that cap (check current Gemini docs) — switching `EXTRACTION_MODEL`
back to full `gemini-3.5-flash` could truncate JSON and trigger exactly this silence.
Fix: read `response.candidates[0].finish_reason`; on `MAX_TOKENS`, empty text, or JSON that
fails to parse, raise `UpstreamError(code="unknown"…)` (or a new `bad_response` code) so the
frontend shows the retry link. Log `finish_reason` next to the `[timing]` line.

### P0-4  Two pending updates for one field are computed against a stale base
Dictate the same field twice before reviewing: the second `new_value` was built from the
form state *without* the first pending change, so accepting both keeps only one, and an
"add …" append can lose the earlier addition. `handleAcceptAll` also re-applies items in
list order, which can overwrite a value the user just accepted individually.
Fix (simple): when a new update arrives for a field that already has a pending item,
replace the older pending item (newest wins) and say so; or disable dictation while
anything is pending. Better: send Gemini the state with pending items applied.

---

## P1

1. **Blocking calls in async routes.** `transcribe`/`extract` are `async def` but call sync
   SDKs and `time.sleep`; one slow request stalls every other. Invisible with one user.
   Fix: `await run_in_threadpool(...)` / `asyncio.to_thread`, or declare the routes `def`.
2. **Latency** (measure first — read the two `[timing]` lines). Ideas, roughly by payoff:
   - Test without ngrok to isolate the tunnel; it relays every request and the audio upload.
   - Cap MediaRecorder bitrate (`audioBitsPerSecond` ≈ 16–24k, mono) — Whisper does not need
     more and the upload shrinks.
   - Check whether Groq offers a faster Whisper variant (e.g. a "turbo" model) — verify the
     current model list before relying on it.
   - Send Gemini only non-empty current fields and only the allowed fields.
   - Experiment: one multimodal Gemini call (audio in → structured updates + transcript
     out) removes a network hop; costs the Whisper vocabulary hint, so compare accuracy.
   - Perceived latency: show per-stage progress ("Transcribing… / Filling in the form…" is
     already there; add elapsed seconds).
3. **View old records (real).** Modal: list by name/date, search box, click → the existing
   print preview. Backend: add `q`, `date_from`, `date_to`, `limit`, `offset` to
   `GET /api/forms`; add indexes on `patient_name` and `date`. Reuse `buildPrintHtml`.
4. **Automated tests.** Backend: pytest + `TestClient` with Groq/Gemini patched (the patterns
   in `docs/TESTING.md` §5). Frontend: Vitest for `voiceCommands.js` and `printTemplate.js`.
   CI: GitHub Actions running `npm run build`, `pytest`, `vitest`, `verify-changes.mjs`.
5. **Extraction regression set.** `backend/tests/extraction_cases.jsonl`: transcript + current
   state → expected `updates`. A script runs them against Gemini and diffs. Every phrasing
   that misfires in real use becomes a case. This is how prompt changes stop being guesses.
6. **Logging and backups.** File logging with request ids (nothing to check after a demo
   failure right now); a scheduled copy of `clinical_forms.db`.
7. **Config hygiene.** `FIELD_SPECS` is duplicated backend/frontend — expose
   `GET /api/schema` and have the frontend read it. Replace deprecated `datetime.utcnow()`.

## P2 — before any real patient data

- Authentication (even a single-clinic login), HTTPS everywhere, per-user audit log.
- Encryption at rest (SQLCipher or encrypted disk/volume); decide retention for
  `raw_transcript_log` and whether to store it at all.
- Alembic migrations (`create_all` cannot alter tables).
- Production hosting: reverse proxy or `VITE_API_BASE`; Dockerfile; FastAPI serving the
  built frontend; Postgres if more than one user.
- Consent and privacy review: audio → Groq, transcripts → Google, Web Speech audio → the
  browser vendor. Confirm obligations under applicable law (e.g. India's DPDP Act) with a
  qualified advisor.

## P3 — improvements

- Hindi / Hinglish dictation (Whisper supports it; needs prompt and vocabulary work).
- Cross-field commands ("move numbness to on examination"); undo last accept.
- Clinic letterhead on the print page (name, registration no., logo) once brand assets arrive.
- Drug-name autocomplete/validation, dose sanity checks, saved medication templates.
- Server-side PDF export; share link.
- Local-only mode (faster-whisper + a local LLM) for privacy.
- Dark-mode toggle (tokens already exist), `aria-live` on status text, focus management in
  the review panel, larger-text mode.

---

## Milestones

| | Goal | Exit criteria |
|---|---|---|
| **M1** | Demo-safe | P0-1…P0-4 fixed; `verify-changes.mjs` shows no P0 open; TESTING.md §2–§6 pass on the demo machine through ngrok |
| **M2** | Trustworthy edits | P1-1, P1-4, P1-5 done; CI green; latency measured and documented |
| **M3** | Records | View-old-records shipped (search, filter, reprint); update endpoint in use; backups + logging |
| **M4** | Pilot-ready | All P2 done; deployed off a laptop; one clinic using it with real (consented) data |
| **M5** | Polish | Final brand design, letterhead print, Hindi support, drug tooling |

## Suggestions (not bugs)

- Run the app through **one week of real dictation by the doctor** and log every wrong
  proposal verbatim — that log is worth more than any prompt guess, and feeds P1-5.
- Decide the "unsaved / saved / finalized" lifecycle of a prescription explicitly (P0-1) —
  it shapes History, Print and audit later.
- Track Gemini/Groq quota use; free tiers are the likeliest cause of a failed demo. Have a
  paid-tier key or a second provider ready for demo day.
- Keep the review panel. Every improvement to extraction makes errors rarer, never
  impossible; the panel is what keeps a rare error harmless.
