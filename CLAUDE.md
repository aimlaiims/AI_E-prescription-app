# CLAUDE.md

Guidance for Claude Code in this repository. Read this first. Depth lives in `docs/`.

## What this is

A voice-driven clinical form for a doctor or their assistant. Dictate a visit, review
what the system heard, nothing is committed until it is accepted, save under a Reference
ID (`RX-YYYYMMDD-XXXX`), print an A4 prescription. Stack: FastAPI + SQLite (backend),
React + Vite (frontend), Groq Whisper (speech-to-text), Gemini (field extraction).

The owner is a developer preparing a **demo for a doctor** (India), not a production
rollout. Treat patient data safety seriously anyway — see "Security posture" in
`docs/ARCHITECTURE.md`.

## Read before non-trivial work

1. `docs/ROADMAP.md` — open P0/P1 issues with concrete fix specs. **Start there.**
2. `docs/ARCHITECTURE.md` — why the pipeline is shaped this way.
3. `docs/CHANGELOG.md` — what was built, how each change is verified.
4. `docs/TESTING.md` — manual test scripts (there is no automated suite yet).

## Commands

Windows / PowerShell is the owner's environment. Use PowerShell syntax
(`Remove-Item -Recurse -Force venv`, not `rmdir /s /q`). **Python 3.11** — 3.14 lacks
wheels for some dependencies.

```powershell
# Backend
cd backend
python -m venv venv; venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env        # then set GROQ_API_KEY and GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxies /api -> :8000
npm run build; npm run preview   # production build on :4173

# Demo tunnel — FRONTEND PORT ONLY, never 8000
ngrok http 5173
```

**Before you say a change is done, run all three:**

```powershell
cd frontend; npm run build            # catches bad imports / JSX / missing icons
cd backend;  python -c "from app.main import app"   # catches import errors
cd frontend; npm test                 # parser + pending-merge tests (node:test, no deps)
node scripts/verify-changes.mjs       # static check of every documented change
```

These prove it compiles and matches the docs. They do **not** prove voice behavior —
that needs live APIs and a browser. Say so plainly rather than claiming a voice feature
works.

## Invariants — do not break these (each exists because of a real failure)

1. **Nothing reaches a form field except through the review panel's Accept, or the user
   typing.** A failed/garbled voice request must only ever produce a banner or a
   cooldown, never a field update. (The prior attempt at this project wrote garbage into
   fields when an API rate-limited.)
2. **Two narrow steps, not one big one.** Whisper transcribes only (no cleanup).
   Gemini extracts via a forced `response_schema` JSON, never free text parsed after.
   An empty `updates` list is a normal, correct outcome.
3. **Every upstream failure is an `UpstreamError` with a `code`**
   (`rate_limited | unavailable | auth | unknown`) — `backend/app/errors.py`. The UI turns
   codes into plain language in `frontend/src/messages.js`. **Never show a raw error
   message, HTTP status, service name, or ".env" to the user.**
   Exception: `validation` errors (missing required fields) are shown verbatim — they are
   actionable form feedback, not service failures. See `handleSaveError` in `App.jsx`.
4. **Pending updates are addressed by stable `id`, never array index.** Several
   accept/reject actions can fire in one batch. At most one item per field is pending
   (`mergePending`), and dictation is interpreted against the form with pending items
   applied (`withPendingApplied`) — see `frontend/src/pendingUpdates.js`.
5. **Voice command words = button labels** ("Accept", "Discard", "Accept all") so the
   interface is learnable. "yes"/"no" are deliberately NOT commands (false triggers).
6. **`FIELD_SPECS` exists twice** — `backend/app/schemas.py` and
   `frontend/src/fieldSpecs.js` — and is not auto-synced. Change both or neither.
7. **The print document is standalone HTML** (`printTemplate.js`) that opens in a new
   window with its own CSS. Escape all user text (`escapeHtml`). The window must be
   opened synchronously in the click handler, before any `await` (popup blockers).
8. **Only tunnel the frontend port.** The API is unauthenticated; the Vite proxy keeps
   requests same-origin. Exposing :8000 bypasses that.
9. **Print must never show data that differs from what is stored.** Enforced by locking
   the form after save (`locked` in `App.jsx`). Don't add an edit path without an update
   endpoint that keeps print and record in step.

## Conventions

- User-facing copy: plain language, sentence case, no jargon. Section labels are
  uppercase small-caps only because the original reference form used them.
- Icons: `lucide-react`. **Verify the icon name exists** in
  `frontend/node_modules/lucide-react/dist/esm/icons/` — names like `Clock3`/`Loader2`
  map to `clock-3.js`/`loader-2.js`. A wrong name fails the build.
- CSS: tokens in `:root` (`--ink`, `--paper`, `--sage`, `--maroon`, `--amber`,
  `--amber-text`, `--control-line`) — final brand colors/logo are coming later, so keep
  the theme loosely coupled; never raw hex in component rules. Dark theme = the same
  tokens under `prefers-color-scheme` / `data-theme` (keep both blocks identical).
  `--ink-faint` is for icons/borders only (fails contrast for text). Breakpoints:
  480 / 640 / 1024. Mobile: sticky bottom action bar, 44px touch targets, 16px input
  font (prevents iOS zoom). Reduced motion must use `animation: none` (shortening the
  duration does not stop looping animations).
- Backend: keep routers thin; external calls live in `services/`; classify every SDK
  exception into `UpstreamError`.
- Keep diffs small and targeted. The owner reviews changes by file; do not reformat or
  rewrite files you were not asked to touch.

## Gotchas that have already cost time

- Backend file is `errors.py` (plural). `error.py` breaks `from ..errors import ...`.
- Restart `npm run dev` after editing `vite.config.js` — it is not hot-reloaded.
- `vite preview` reads its own `preview:` config block; `server:` does not apply to it.
  ngrok's free domain suffix has changed before (`.ngrok-free.dev` now); a blocked host
  error means `allowedHosts` is out of date.
- `create_all()` does not alter existing tables. A new column needs a migration (or
  deleting the dev `.db`).
- Groq/Gemini free tiers rate-limit (429) and get overloaded (503). Both are handled;
  do not "fix" a 503 by removing the retry logic.
- Browser speech recognition (voice confirm) is Chrome/Edge only and sends audio to the
  browser vendor, separate from our Groq/Gemini pipeline. ngrok does not affect it.

## Where to start

All P0s are fixed except the unverified **P0-2d** (Space with a button focused — test it in a
browser, `docs/TESTING.md` §4). Next is P1 in `docs/ROADMAP.md`; ask the owner which first.
