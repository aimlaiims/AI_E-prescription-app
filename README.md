# Clinical Voice Form

Dictate a patient visit, review what was heard, save it under a Reference ID, print a
prescription. Built for a doctor or their assistant.

> **Status: demo, not production.** Doctors sign in (invite-code sign-up, email password
> reset) and each sees only their own prescriptions. Still missing before real patient data:
> encryption at rest and a consent/privacy review (audio goes to Groq, transcripts to Google).

## How it works

```
mic ──► Groq Whisper ──► transcript ──► Gemini (forced JSON schema) ──► proposed updates
                                                                            │
   form fields  ◄── only on Accept ── Review panel (old → new + evidence) ◄─┘
```

- **Whisper transcribes only.** **Gemini** turns the transcript into field updates
  (`add …` appends, `change X to Y` edits in place, plain restatement replaces).
- **Nothing is written to the form until the doctor accepts it** — by click or by voice
  ("accept", "accept diagnosis", "accept all").
- Two mics: one per field, and one for the whole visit (also toggled with **Space**);
  only one records at a time. Hands-free confirm while dictating is paused.
- Save → generates a Reference ID and the prescription becomes final. Print → A4 page.
- **View past prescriptions** — search by name or Reference ID, filter by date, preview,
  reprint.
- Works on phones (sticky Save/Print bar) and desktops; light and dark theme.

## Quick start (Windows / PowerShell, Python 3.11, Node 18+)

```powershell
# Backend
cd backend
python -m venv venv; venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env         # add GROQ_API_KEY and GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                    # open http://localhost:5173
```

Use **Chrome or Edge** — hands-free confirm relies on the browser's speech API.
Microphone access needs `localhost` or HTTPS.

Sharing a demo link: `ngrok http 5173` (frontend port only, never 8000). If you serve
the production build instead (`npm run build; npm run preview`), tunnel 4173 and rebuild
after every change.

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `WHISPER_BACKEND` | `groq` (default) or `local` (faster-whisper) |
| `GROQ_API_KEY` | Groq speech-to-text |
| `GEMINI_API_KEY` | Gemini field extraction |
| `EXTRACTION_MODEL` | default `gemini-3.5-flash-lite` |
| `DATABASE_URL` | `sqlite:///./clinical_forms.db` (default) or `postgresql://USER:PASSWORD@HOST:5432/DBNAME` |
| `APP_TIMEZONE` | default `Asia/Kolkata` (IST) — dates, times and Reference IDs, whatever the server's own timezone |
| `GROQ_MAX_IN_FLIGHT` / `GEMINI_MAX_IN_FLIGHT` | voice calls in progress at once per provider (default 8); more wait in a fair queue |
| `GROQ_PER_MINUTE` / `GEMINI_PER_MINUTE` | calls started per minute (0 = no limit); set just below your plan's limit |
| `VOICE_QUEUE_WAIT_SECONDS` | longest wait before "many people are using voice input" (default 15) |
| `TRANSCRIBE_TIMEOUT_SECONDS` / `EXTRACT_TIMEOUT_SECONDS` | longest one call may take (default 30) |
| `VOICE_MAX_PER_USER` / `MAX_AUDIO_MB` | voice requests per user at once (3); largest recording (10 MB) |
| `SIGNUP_CODE` | invite code needed to create an account (empty = sign-up closed) |
| `INSTITUTION_NAME` | shown on the letterhead and printed prescriptions |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | password-reset email; empty = link printed in the backend terminal |
| `APP_BASE_URL` | public address for links in emails (e.g. the ngrok URL) |

First run: set `SIGNUP_CODE`, open the app, choose **Create an account**. Every API call
except `/api/health` needs a signed-in doctor.

## Database and backups

SQLite (the default, one file) or PostgreSQL — chosen by `DATABASE_URL`. The app
creates and updates the tables itself at startup (Alembic migrations in
`backend/alembic/`); for PostgreSQL, create an empty database first.

**SQLite** suits one server and a few doctors. **PostgreSQL** is the choice once data is
real or several departments use it: managed backups and point-in-time restore,
database users and roles, and what hospital IT usually expects.

**Backups** (from `backend/`, safe while the app runs):

```powershell
python -m tools.backup_database --to D:\cvf-backups --keep 60
```

SQLite: a checked `.db` copy. PostgreSQL: a `pg_dump` file (`pg_dump` comes with
PostgreSQL; its `bin` folder must be on PATH). Schedule it (Windows Task Scheduler or
cron), keep the folder on **another disk or machine**, and restore one now and then —
an untested backup is a guess:

- SQLite: stop the app, copy the backup over `clinical_forms.db` (delete any
  `clinical_forms.db-wal` / `-shm` next to it), start the app.
- PostgreSQL: `pg_restore --clean --dbname=DBNAME FILE.dump`, with the app stopped.

Never copy the SQLite file by hand while the app is running — use the tool. Don't
put the SQLite file on a network drive.

**Moving from SQLite to PostgreSQL:** stop the app, back up, create an empty
PostgreSQL database, then

```powershell
python -m tools.copy_database --from sqlite:///./clinical_forms.db --to postgresql://USER:PASSWORD@localhost:5432/cvf
```

It checks everything first and copies in one transaction (every record or none), then
counts. Set `DATABASE_URL` to the PostgreSQL address and start the app.

## Docs

| File | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | Design, data flow, API, error handling |
| `docs/TESTING.md` | Manual test scripts and how to simulate failures |
