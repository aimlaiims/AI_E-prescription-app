# Clinical Voice Form

Dictate a patient visit, review what was heard, save it under a Reference ID, print a
prescription. Built for a doctor or their assistant.

> **Status: working demo, not production.** No authentication, no encryption at rest.
> Do not use with real patient data until the P2 items in `docs/ROADMAP.md` are done.

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
- Two mics: one per field, and one for the whole visit (also toggled with **Space**).
- Save → generates a Reference ID. Print → formatted A4 preview.

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

Sharing a demo link: `ngrok http 5173` (frontend port only, never 8000).

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `WHISPER_BACKEND` | `groq` (default) or `local` (faster-whisper) |
| `GROQ_API_KEY` | Groq speech-to-text |
| `GEMINI_API_KEY` | Gemini field extraction |
| `EXTRACTION_MODEL` | default `gemini-3.5-flash-lite` |
| `DATABASE_URL` | default `sqlite:///./clinical_forms.db` |

## Docs

| File | What it is |
|---|---|
| `CLAUDE.md` | Rules and commands for Claude Code |
| `docs/ARCHITECTURE.md` | Design, data flow, API, error handling |
| `docs/CHANGELOG.md` | What was built and how each change is verified |
| `docs/ROADMAP.md` | Open issues, suggestions, milestones |
| `docs/TESTING.md` | Manual test scripts and how to simulate failures |
| `scripts/verify-changes.mjs` | `node scripts/verify-changes.mjs` — static check of the above |
