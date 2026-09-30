# Plan: AIIMS look (from the colleague's app) + real doctor login

> **Status: planned, not started (2026-09-30).** Work starts on the owner's command, as two
> branches: **A `ui-aiims`** (UI only, lands first) and **B `login`** (built on A, lands second).
> Each lands on `main` only after the owner's go. Agreed in a planning session; decisions below
> are the owner's.

## Context
The colleague's app (`C:\Users\Akshay\Downloads\e-prescription-app-frontend-main.zip`; React 19
+ TS + Tailwind 4) has the look the owner wants (AIIMS branding, letterhead-style sheet, login
screens), but its logic conflicts with this project: browser speech + regex writing straight
into fields (breaks invariants 1–2), voice "save and print"/"clear", localStorage accounts with
plaintext passwords, localStorage records, `window.print()` of the page. Goal: take the **UI
only**, rebuilt in our Vite + JSX + plain CSS, keep every CLAUDE.md invariant, and build the
login **for real** (server-side). Real login also closes today's biggest gap: the public ngrok
link lets anyone call the API and spend the Groq/Gemini quota.

## Owner decisions (2026-09-30)
- AIIMS branding on screen **and** on the printed letterhead (logo, doctor, institution).
- **No** side panel/bottom sheet: keep our dictate bar + review panel; restyle colours only.
  Owner's dictate-bar suggestions still pending — slot kept, not in this plan.
- **Real login now**: sign-up gated by an **invite code**; **email reset link via SMTP**
  (Gmail app password etc.); each doctor sees **only their own** prescriptions; letterhead
  from **each doctor's profile** (+ institution name/logo from settings).
- The 7 existing (test) prescriptions: **delete** at landing (DB backed up first; confirm).
- Ignore Phone / Treatment fields. 10s auto-stop: later, whole-visit mic only.
- Skip from his code: speech/regex parser, voice save/clear commands, localStorage
  storage/auth, delete-from-history, `window.print()` page, fake "Acoustic level" select,
  side panel, TS/Tailwind/React 19/react-hook-form/Vite 8.

## Backend — accounts and sessions (stdlib only, no new runtime deps)
- **Models** (`backend/app/models.py`): `Doctor` (login `doctor_id` unique, `full_name`,
  `email` unique, `qualification`, `specialization`, `registration_no`, `password_hash`,
  `created_at`); `Session` (sha256 of token, doctor FK, `expires_at`); `PasswordReset`
  (sha256 of token, doctor FK, `expires_at`, `used_at`). `ClinicalForm.doctor_id` (FK).
- **Migration:** `create_all` can't add a column to the existing table → new
  `backend/app/migrations.py`: small ordered, idempotent steps run at startup (pattern of
  the index creation already in `main.py`): add `clinical_forms.doctor_id` if missing.
- **Passwords:** `hashlib.scrypt` with per-user salt, `hmac.compare_digest`; min length 8.
- **Sessions:** `secrets.token_urlsafe(32)` in an **HttpOnly** cookie, `SameSite=Lax`,
  `Secure` when served over HTTPS (ngrok); only the hash is stored. 12h, or 30 days with
  "Remember me". Logout deletes the session. Origin check on unsafe methods (CSRF).
- **Login throttling:** 5 failures per doctor ID / IP per 15 min → 429 (in memory).
- **Endpoints** (`backend/app/routers/auth.py`, thin; logic in `services/auth.py`):
  `POST /api/auth/signup` (needs `SIGNUP_CODE` from `.env`; unset → sign-up disabled),
  `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (profile +
  institution settings), `POST /api/auth/forgot` (always 200 — no account probing),
  `POST /api/auth/reset` (token single-use, 30 min; ends that doctor's other sessions).
- **Email:** `services/email.py` via stdlib `smtplib` (STARTTLS). `.env`: `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `APP_BASE_URL`. Not configured →
  the reset link is logged to the backend terminal (dev/testing).
- **Protect everything:** a `current_doctor` dependency on every `/api` route except
  `auth/*` and `health` → 401 `unauthenticated`. Voice routes too (quota).
- **Ownership:** save stamps `doctor_id`; `GET /api/forms` and `GET /api/forms/{pid}` only
  return the caller's records (other doctor's pid → 404, same as unknown).
- **Settings** (`config.py`, `.env.example`): `SIGNUP_CODE`, SMTP vars, `APP_BASE_URL`,
  `INSTITUTION_NAME` (e.g. "All India Institute of Medical Sciences, Raipur").

## Frontend — his look, our logic
1. **Palette** (`styles.css` tokens, names kept): AIIMS blue (#1e3a8a / #1d4ed8 / #2563eb) for
   primary/brand, red #b91c1c for required/recording, slate page background, white paper;
   dark-theme variants; every text pair contrast-checked (≥4.5:1).
2. **Logo:** `frontend/public/aiims-logo.png` from his zip (favicon too).
3. **Top navbar:** logo, "AIIMS E-Prescription", today's date, "History" (opens our
   RecordsDialog), doctor name, Logout.
4. **Sheet as letterhead:** blue header band (logo, doctor name, qualification ·
   specialization, institution), red–blue stripe, faint logo watermark, ℞ divider
   between patient info and clinical sections, his section-heading style; footer strip.
5. **Restyle only:** dictate bar, review panel, banners, save button, records dialog —
   structure and behaviour unchanged.
6. **Auth screens** (new `components/auth/`): his AuthLayout (brand panel — animations
   stop under reduced motion), Login (Doctor ID, password, show/hide, Remember me, Forgot),
   Sign-up (invite code, full name, doctor ID, email, qualification, specialization,
   registration no., password + confirm), Forgot (email), Reset (from `?reset=<token>`).
   No router library: App shows auth screens until `GET /api/auth/me` succeeds.
7. **Session handling:** `api.js` sends cookies (same-origin); any 401 → back to Login with
   "Please sign in again" (form content is not silently lost: warn if unsaved). New
   `unauthenticated` code in `messages.js`.
8. **Print letterhead:** `buildPrintHtml(..., { letterhead })` gets doctor + institution +
   logo as a data URI (works in the print window and the records preview iframe).

## Two branches (both in the scratch worktree; each lands on `main` only after your go)

### Branch A — `ui-aiims` (UI only, no backend change; lands first)
1. Palette, logo + favicon, navbar (logo, title, date, History), letterhead-style sheet
   (band shows logo + institution; doctor details slot left for branch B), stripe,
   watermark, ℞ divider, footer; restyle dictate bar, review panel, banners, save
   button, records dialog.
2. Print letterhead: logo (data URI) + institution on the printed page; doctor details
   are added in branch B.
3. Docs + verify-changes for the UI; real-Chrome checks (widths, light/dark, reduced
   motion, contrast).

### Branch B — `login` (starts from branch A; lands second)
1. Backend: models, migrations, hashing, sessions, auth endpoints, throttling + tests.
2. Backend: protect routes, ownership + update the existing tests to an authenticated client.
3. Backend: forgot/reset + SMTP + tests (fake SMTP server).
4. Frontend: auth screens (his design) + session handling; navbar gets doctor name +
   Logout; sheet band + print letterhead get the doctor's name, qualification,
   specialization, registration no. (+ Vitest for the forms).
5. Docs: CLAUDE.md (new invariants: every API behind login; no plaintext secrets; records
   per doctor), ARCHITECTURE, TESTING, CHANGELOG, `.env.example`, verify-changes.

## Landing (needs you)
- **Branch A:** copy onto `main`, `npm run build`. Confirm with AIIMS that their name/logo
  may appear on printed prescriptions.
- **Branch B:** set `SIGNUP_CODE`, SMTP settings, `APP_BASE_URL` (ngrok URL) and
  `INSTITUTION_NAME` in `backend/.env`. Back up `backend/clinical_forms.db`, then delete the
  7 old records (I confirm first). Copy onto `main`, `npm run build`; the backend reloads
  itself. The first sign-up is you.

## Verification
- pytest: signup (code required/wrong/unset), login, throttling, cookie flags, logout,
  `/me`, every protected route → 401 signed out, doctor A can't list/get doctor B's record,
  reset (single use, expiry, sessions ended), SMTP fallback, migration on a copy of the
  live DB. Plus the existing 53, adapted.
- Frontend: `npm test` (+ auth form tests), build, verify script.
- Real Chrome (scratch): auth screens + app at 320/375/768/1440, light/dark, reduced
  motion; contrast; no overflow; 44px targets. End-to-end on a test backend: sign up →
  log in → dictate (TTS, real APIs) → save → History → print with letterhead + logo →
  log out → 401 on direct API calls → reset via logged link.
- Not provable here: real email delivery through your SMTP; the doctors' phones.
