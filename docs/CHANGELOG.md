# Changelog

Not semver — this is the history of the build, in order, written so each item can be
checked. **Static** = `node scripts/verify-changes.mjs` covers it. **Live** = only a
person with real API keys and a browser can confirm it (see `docs/TESTING.md`).

## Read this first: what "correctly implemented" means here

Everything below was written and tested in a **sandbox copy** of the repo, not on the
owner's machine. Two consequences:

1. The owner applied changes by hand from chat, and several were pasted incompletely at
   least once (a whole file was never shown; a `messages.js` export was missing). The
   sandbox and the real repo may differ. **Run `node scripts/verify-changes.mjs` in the
   real repo first.** Any `✘` is a change that did not land.
2. Verification split:

| Verified in sandbox | How |
|---|---|
| Frontend compiles after every change | `npm run build` |
| Backend imports and routes work | `python -c "from app.main import app"`; FastAPI `TestClient`: health, save, get, list, validation 400 shape, and a mocked `UpstreamError` → HTTP 429 with `retry_after_seconds` |
| Print template output | Node: doctype, values present, empty optional section omitted, `<script>`/`&` escaped, empty-medications message |
| Voice command parser | Node, running the **shipped** code extracted from `ReviewPanel.jsx` |
| `vite preview` serves the build | started on :4173, HTTP 200 |
| Every change below is present | `verify-changes.mjs`: 51/51 |

| **Not** verified by anyone but the owner (or not at all) | Why |
|---|---|
| Any live Groq/Gemini call | no API keys in the sandbox |
| Prompt behavior (append / correct / replace, synonyms), flash-lite speed, `[timing]` output | needs live Gemini |
| Web Speech reliability; the "commands merge into one result" explanation | browser + microphone; still a **hypothesis** |
| Space key with a button focused; MediaRecorder; pop-up blocking; print rendering | browser behavior |
| Visual layout at phone/tablet/desktop widths | no screenshots were possible |
| ngrok flow and latency through it | needs the tunnel |

## Corrections to earlier statements

- Gemini 503 retry wait is **1.5s then 3s ≈ 4.5s** worst case (plus three request
  times), not "~10.5s" as stated earlier — the third attempt has no sleep after it.
- "A 350ms restart delay is measurably more reliable" was overstated. It is a common
  workaround for a known Chrome quirk; it was never measured here.
- `verify-changes.mjs` first reported a known issue as "fixed" whenever its bug pattern was
  not found. Against a repo whose code was shaped slightly differently (`word` vs `w` as a
  loop variable) it wrongly reported P0-2a, P0-2c and P0-3 fixed. It is now three-state and
  "fixed" requires positive evidence; tested against old-shaped and unrecognised code.
- `.env.example` (`gemini-3.5-flash`) disagreed with the code default
  (`gemini-3.5-flash-lite`); `README.md` still described Claude extraction;
  `requirements.txt` still pinned versions that fail on Python 3.14. All three are fixed
  in this doc set.

---

## 1. Scaffold
FastAPI + SQLite + React/Vite. Per-field mic, whole-form mic, review panel, save with
generated PID, list/get endpoints.
Files: `backend/app/*`, `frontend/src/*`. **Static ✔**

## 2. Extraction moved from Claude to Gemini
`google-genai`, `client.models.generate_content` with `response_mime_type=application/json`
and `response_schema` (equivalent guarantee to the earlier forced tool call).
Files: `services/extraction.py`, `config.py`, `.env.example`, `requirements.txt`. **Static ✔ · Live**

## 3. Reliability and error taxonomy
- `errors.py`: `UpstreamError(code, retry_after)`; `http_status()`.
- Groq and Gemini SDK exceptions classified (rate limit, auth, 5xx, connection).
- Gemini 5xx: retry with backoff. Gemini 429: **not** retried; returns `retry_after`.
- `voice.py` returns `{"detail": {"error_code","message","retry_after_seconds"}}`.
- `api.js` `ApiError`; `App.jsx` app-wide cooldown disables every mic with a countdown.
- Nothing from a failed request can become a field update.
Files: `errors.py`, `services/*.py`, `routers/voice.py`, `api.js`, `App.jsx`, `FormField.jsx`,
`DictateBar.jsx`. **Static ✔ · TestClient ✔ (mocked 429) · Live (real 429/503)**
Verify by hand: `docs/TESTING.md` §5.

## 4. Plain-language copy layer
`messages.js` maps codes to text; UI never shows service names, status codes, `.env`.
"PID" is shown as "Reference ID". **Static ✔**

## 5. UI redesign and responsive layout
Paper-sheet layout, `lucide-react` icons, sentence-case copy, removed a generic
all-caps/em-dash heading, no technical wording in the UI, sticky mobile action bar, 44px targets,
16px inputs. Copy-to-clipboard on the Reference ID.
Files: `App.jsx`, `styles.css`, all components, `package.json`. **Static ✔ · Live (visual)**

## 6. Whole-visit mic icon + Space shortcut
Large round mic with idle/recording/processing states. Space toggles it unless focus is in
input/textarea/select; key-repeat ignored; `preventDefault` stops page scroll.
File: `DictateBar.jsx`, `styles.css`. **Static ✔ · Live** — untested edge: Space with a
*button* focused (ROADMAP P0-2d).

## 7. Print, and save-on-print
`printTemplate.js` (standalone A4 HTML, escaped, empty optional sections omitted). Print
saves first if unsaved, opens the window before any `await`. Toolbar row: "View old
records" (placeholder note) and "Clear form". Save validation now returns
`error_code: "validation"` with **field labels** ("Please fill in: Diagnosis, …") and is
shown verbatim (previously misrouted through voice-error text).
Files: `printTemplate.js`, `App.jsx`, `routers/forms.py`. **Static ✔ · Node ✔ · TestClient ✔ · Live (print rendering, pop-up blocker)**
**Known defect:** editing after save can print text that differs from the stored record (P0-1).

## 8. Demo tunnelling
`vite.config.js`: `server.allowedHosts` and a separate `preview` block (own port 4173,
proxy, allowedHosts) covering `.ngrok-free.dev/.app`, `.ngrok.io/.app`.
**Static ✔ · preview serves ✔ · Live (ngrok)**

## 9. Extraction prompt: synonyms and merge rules
Spoken synonyms (sex→gender, O/E→on_examination, Dx, Ix, Rx…). Rule 4: append on "add/
also", in-place edit on "change X to Y", replace on plain restatement, for free-text
fields only. **Static ✔ · Live** — the most model-dependent change in the repo.

## 10. Transcript-preserving retry
If transcription succeeds and extraction fails, `DictateBar` keeps the transcript and offers
"Try filling in the form again — no need to redictate". Cleared on success or a new
recording. Not added to per-field mics (deliberate). **Static ✔ · Live**

## 11. Hands-free voice confirm (evolution)
Browser `SpeechRecognition`. In order: added; removed "yes"/"no" (matched inside ordinary
sentences); "except" accepted as a mishearing of "accept"; locale from `navigator.language`
instead of hard-coded `en-US`; 350ms delayed restart + listening dot; debug "Heard: …"
line removed from the UI; **multi-command parsing** (`parseVoiceCommands`) and **id-based**
accept/reject (`App.jsx` `nextPendingId`) so several commands in one utterance all apply.
Files: `ReviewPanel.jsx`, `App.jsx`, `styles.css`. **Static ✔ · Node ✔ (5 scenarios) · Live**
**Known defects:** targeting bugs P0-2 (`accept age`, `accept exam`, mumbled names act on the
top item), and only the last recognition result per event is read.

## 12. Latency work
Default model → `gemini-3.5-flash-lite`; `[timing]` lines for Groq and Gemini;
`max_output_tokens: 1024`. **Static ✔ · Live** — the speedup is *unmeasured*; run it and read
the terminal. **Risk:** see ROADMAP P0-3 (truncation returns silent "no updates").

## 13. Documentation and tooling (this set)
`CLAUDE.md`, `README.md`, `docs/*`, `scripts/verify-changes.mjs`, corrected
`.env.example` / `requirements*.txt`.

## 14. Handoff to Claude Code: repo merged with the chat sandbox snapshot
The real repo and the sandbox had each diverged. Kept from the repo (not in the sandbox):
microphone error classification (`MicError`, `MIC_MESSAGES`), context-specific save/print
error text, per-field "nothing heard / nothing found" notes, structured `empty_audio` and
`not_found` errors, validation labels in form order, required-fields legend, extraction
warning log. Brought in from the sandbox: id-based pending updates, `parseVoiceCommands`,
`RESTART_DELAY_MS` + listening dot, `[timing]` logs (via `logging`, not `print`),
`max_output_tokens`, flash-lite default, cleaned `.env.example`, three-state
`verify-changes.mjs`. **Static ✔ 51/51 · TestClient ✔ (stubbed Gemini: timing logged, cap sent) · Live**
