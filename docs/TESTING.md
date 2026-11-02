# Testing

Manual test scripts: real speech, the browser, the tunnel, and how to simulate failures.
Quick sanity checks after any change: `cd frontend; npm run build` and
`cd backend; python -c "from app.main import app"`.

Run the manual tests on the machine and browser that will be used for the demo
(**Chrome or Edge**), including once **through the ngrok URL**.

## 0. Accounts
- [ ] `python -m tools.create_admin --email … --name …` → sign in with that email; the
      navbar shows **Accounts**; letterhead shows "ENT Department · …"
- [ ] Running `create_admin` again with another email refuses ("There is already an
      administrator"); `--replace` moves the role
- [ ] Accounts → Registration codes → pick the department, "Who is it for?" → Create →
      the code shows once in large type (Copy works), "Works once, for 72 hours"
- [ ] On the tablet: sign-in → **Register with a code** → type the code in lower case,
      no dash (it formats itself) → Continue says "Registering for ENT Department" → fill
      the details (designation free text) → Register → "Registration sent"
- [ ] The same code again → "This code doesn't work…"; 5 made-up codes → told to wait
- [ ] Sign in before approval → "waiting for the administrator's approval"; Forgot
      password for that email sends nothing
- [ ] Accounts: the doctor is at the top under **Waiting for approval**; the code says
      "Used by Dr. …" → Approve → the doctor signs in; letterhead shows
      "Designation · Qualification · Specialization"; no Accounts button for a doctor
- [ ] A second code → Revoke → it no longer works; Reject a registration (asks first) →
      that account can't sign in
- [ ] 5 wrong passwords → told to wait
- [ ] Deactivate a doctor (asks first) → their open app asks them to sign in, which says
      the account is deactivated; Reactivate → they can sign in, their prescriptions are there
- [ ] The administrator's own account has no Deactivate button; editing has no role
- [ ] Forgot password → email arrives (or, without SMTP, the link is in the backend
      terminal) → new password works, old one doesn't, the link can't be reused
- [ ] Second doctor's account: History shows none of the first doctor's prescriptions
- [ ] Session ends while a form is open (e.g. sign out in another tab) → sign-in box over
      the form; after signing in the form is still there
- [ ] Sign out with an unsaved form → asks first
- [ ] Printed prescription: doctor's name, qualification, registration no., institution,
      "ENT Department", seal

## 0b. Database
- [ ] Fresh start on SQLite: the backend log says "database schema up to date (sqlite)"
- [ ] An existing database from before this change starts fine and keeps its records
- [ ] PostgreSQL: empty database, `DATABASE_URL=postgresql://…`, start → log says
      "(postgresql)"; create the admin, sign in, save, History, print all work
- [ ] Age "2 years 6 months" saves; a 41-character age → "Please shorten Age (at most 40
      characters)."
- [ ] `python -m tools.backup_database` → a file in `backend/backups/`; restore it into a
      spare database / copy and open a saved prescription from it
- [ ] `python -m tools.copy_database --from … --to …` on a copy → same counts; the app
      on the target can save a NEW prescription (ids continue after the copied ones)

## 1. Setup checks
- [ ] `GET /api/health` returns `{"status":"ok","whisper_backend":"groq"}`
- [ ] Browser grants microphone permission on first use (needs `localhost` or HTTPS)
- [ ] Pop-ups allowed for the site (Print opens a new tab)
- [ ] Backend terminal shows `[timing]` lines after a dictation

## 2. Dictation
Read each aloud into the whole-visit mic. The date fills itself.

**Case 1 — respiratory**
> "Patient is Rakesh Bansal, forty two year old male. Chief complaint is fever, cough, and chest congestion for four days. On examination, bilateral crepitations present, throat mildly congested, temperature hundred and one point two Fahrenheit. Diagnosis is acute bronchitis. Investigation advised, chest X-ray and complete blood count. Medications, Tab Azithromycin five hundred milligrams, one-zero-zero once daily for three days, and Tab Paracetamol six fifty milligrams, one-one-one after food for three days."

**Case 2 — gastrointestinal**
> "Patient is Sunita Reddy, twenty nine year old female. Chief complaint is abdominal pain and vomiting since yesterday evening, along with loss of appetite. On examination, mild tenderness in the epigastric region, no guarding, bowel sounds normal. Diagnosis is acute gastritis. Investigation, ultrasound abdomen if symptoms persist beyond two days. Medications, Tab Pantoprazole forty milligrams, one-zero-zero before breakfast for five days, and Tab Ondansetron four milligrams, as needed for vomiting."

**Case 3 — musculoskeletal**
> "Patient is Gopal Krishnan, sixty eight year old male. Chief complaint is lower back pain radiating to the left leg for two weeks, worse on standing. On examination, straight leg raise test positive on the left, no motor weakness, reflexes normal. Diagnosis is lumbar radiculopathy. Investigation, MRI lumbar spine. Medications, Tab Aceclofenac one hundred milligrams, one-zero-one after food for five days, Cap Pregabalin seventy five milligrams, zero-zero-one at bedtime for two weeks, and physiotherapy advised."

Expect: every field proposed, evidence shown, nothing in the form until Accept.
Watch: "physiotherapy advised" in medications (not a drug — does it stay sensible?);
"investigation… if symptoms persist" (conditional phrasing).

Terse / synonym forms (per-field or whole visit):
- "name Priya Sharma, age 28, sex female, Dx iron deficiency anemia" → four proposals, `sex` → gender
- "sex female, C/O headache and dizziness, O/E BP one twenty over eighty, Rx Tab Sumatriptan fifty mg"
- Filler only: "okay let me just check something" → **no** proposals
- Half relevant: "diagnosis is type 2 diabetes, and remind the nurse to check the vaccine fridge" →
  diagnosis proposed; fridge remark appears under "Also heard, but it didn't fit any field"

## 3. Append / correct / replace (prompt rule 4)
On Chief complaints:
1. "right ear pain" → accept
2. "left ear pain" → replaces → `Left ear pain`
3. "add numbness in left cheek" → **appends** → `Left ear pain` / `Numbness in left cheek`
4. "change left ear to right ear" → edits only that part → `Right ear pain` / `Numbness in left cheek`
5. Edge: "left ear pain too" (is "too" read as addition?)
6. Edge: "change ear pain to eye pain" in a 3-line value → only the matching line changes
7. Empty field + "add fever" → behaves as a plain fill
8. **Without accepting**, say "fever" then "add cough" on the same field → ONE pending item,
   tagged **Updated**, value `Fever` / `Cough`; its "old" line is the real field value
9. Pending diagnosis + whole-visit dictation that restates diagnosis → still one diagnosis item

## 4. Voice confirm and Space
Get 4–5 proposals pending (Case 1 works), toggle **Hands-free**.
- [ ] "accept" → top item only
- [ ] "accept diagnosis" → that item
- [ ] **"accept age"** → age
- [ ] **"accept exam"** → on examination
- [ ] mumbled/nonsense field name → nothing accepted, amber "Didn't catch which item" notice
- [ ] top item shows a **Next** tag while hands-free is on; bare "accept" acts on it
- [ ] Hands-free on + items pending, start any mic and say "confirm diagnosis, remove sutures"
      → nothing is accepted/discarded; "paused while you dictate" shows; resumes after stop
- [ ] Block the mic for the site, turn hands-free on → it switches itself off with a message
      (no silent retry loop)
- [ ] "accept diagnosis accept medications accept all" in one breath → all three act
- [ ] "no wait let me check the chart" → nothing happens (false-positive guard)
- [ ] "except all" → treated as "accept all"
- [ ] dot pulses when listening; goes dim briefly on reconnect
- [ ] Click **Accept**/**Discard** buttons → same result as voice

Space (whole-visit mic):
- [ ] Nothing focused, press Space → recording starts; again → stops; page does not scroll
- [ ] Focus in any text field, type a sentence with spaces → types normally, never toggles
- [ ] Hold Space → one toggle, not a stream
- [ ] **Click the mic with the mouse, then press Space** → toggles once, not twice
- [ ] **Click Print, return to the tab, press Space** → does not re-trigger Print

## 5. Failure paths (simulate — do not wait for a real outage)
Confirm for each: a banner or cooldown appears, **no field changes**, no service name,
status code or ".env" is visible.

| Simulate | How | Expect |
|---|---|---|
| Bad Gemini key | set `GEMINI_API_KEY=x`, restart backend | "not set up correctly" message |
| Bad Groq key | set `GROQ_API_KEY=x` | same |
| Network off | disable Wi-Fi mid-dictation | generic "interrupted" message + retry link if transcript existed |
| Rate limit (UI) | temporarily add `raise UpstreamError("x", code="rate_limited", retry_after=12)` at the top of `extract()` in `voice.py` | amber banner, **all** mics disabled, countdown, mics return at 0 |
| 503 | temporarily raise `UpstreamError("x", code="unavailable")` | error banner + "Try again (no need to redictate)" in the dock; works once the raise is removed |
| Missing required fields | Save/Print with empty form | "Please fill in: …" with **field labels** |
| Many people at once | in `.env`: `GEMINI_MAX_IN_FLIGHT=1`, `VOICE_QUEUE_WAIT_SECONDS=1`; restart; dictate from two devices/tabs (two accounts) at the same moment | one gets the result, the other "Many people are using voice input right now…"; **no field changes** |
| Hung provider | `EXTRACT_TIMEOUT_SECONDS=0.5`, restart, dictate | "isn't responding" banner within a second; no field changes |
| Long recording | `MAX_AUDIO_MB=0.05`, restart, dictate for ~10 s | "That recording is too long. Please dictate in shorter parts." |

Backend-only pattern (simulate an upstream failure without a browser):
```python
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app
from app.errors import UpstreamError

client = TestClient(app)
with patch("app.routers.voice.extract_field_updates",
           side_effect=UpstreamError("x", code="rate_limited", retry_after=15.0)):
    r = client.post("/api/extract", json={"transcript": "age 34",
        "current_state": {k: "" for k in ["patient_name","date","age","gender","chief_complaints",
                                          "on_examination","diagnosis","investigation","medications"]},
        "target_field": "age"})
assert r.status_code == 429
assert r.json()["detail"] == {"error_code": "rate_limited", "message": "x", "retry_after_seconds": 15.0}
```

## 6. Save, print, reference ID
- [ ] Fill required fields → **Save** → banner shows `RX-YYYYMMDD-XXXX`; copy button works
- [ ] After save the form is **locked**: fields read-only, no mics, no review panel,
      button reads "Saved"; "Start a new prescription" resets everything
- [ ] Save (or Print on an unsaved form) with proposals still pending → blocked with
      "…still waiting for review…", nothing saved
- [ ] Start a field mic, then Save from the footer → mic stops, nothing is proposed
- [ ] Print on an unsaved form saves first, then opens the preview (one record, not two)
- [ ] Preview: patient row, sections, medications box, signature line; Print/Close buttons
      visible on screen, **hidden in the print dialog**; A4 fits without a stray page
- [ ] Empty On Examination / Investigation are omitted; empty medications says "No medications prescribed."
- [ ] Type `<script>alert(1)</script>` as a name → printed literally, not executed
- [ ] Pop-ups blocked → friendly message, not a silent failure
- [ ] Save, then Print → printout matches the stored record (editing is impossible once saved)
- [ ] Start a dictation, click **New prescription** before it finishes → nothing from it appears
      on the new form; no retry link carried over
- [ ] Between midnight and 5:30 am IST the date field shows today's date, not yesterday's
- [ ] **iPhone/Safari**: dictate one field → transcribed (upload is now named .mp4)

## 7. Responsive and visual
Automated once for the v0 port (2026-09-29, real Chrome, API stubbed): no horizontal
scroll and all tap targets ≥ 44px at 320/375/768/1440 in six states (empty, recording,
review with Next + Updated, missing fields, cooldown, locked), light + dark. Re-check
by hand on the doctor's actual phone. Check at 375px, 768px, 1280px:
- [ ] 375: the mic dock floats at the bottom; Print / Save at the end of the form are
      not hidden behind it; patient fields stack; no horizontal scroll; inputs do not
      zoom on focus (iOS)
- [ ] Phone turned sideways: slim navbar and doctor's card, the form starts on screen
      after sign-in (not scrolled down), fields in three columns
- [ ] 768/1280: doctor's card + white pad, patient fields in three columns
- [ ] Dock: "Listening…" with moving bars only while recording; status text, banners
      and review panel wrap cleanly; after Save the dock is gone
- [ ] Logos (navbar, doctor's card, sign-in, page footer): a round seal, no square corners
- [ ] Tap targets ≥ 44px; recording state (maroon pulse) and processing spinner visible
- [ ] Save with empty required fields → red outlines + "Please add …"; they clear as you type
- [ ] Press Enter in Patient name → nothing is saved
- [ ] Hands-free on → toggle turns sage and the dot is visible
- [ ] OS set to "reduce motion" → no pulsing mic / dot / spinner animation
- [ ] Print a record with 24+ medication lines → signature never alone on the last page

## 6a. Advice
- [ ] Type or dictate Advice ("advise steam inhalation, review after two weeks") → it goes
      to Advice, not Medications; "add …" appends a line
- [ ] Printout: Advice under the medicines; with long medicines + advice the signature is
      never alone on the last page (the last Advice lines go with it)
- [ ] Past visits shows Advice

## 6b. Patients
- [ ] New patient: fill the form (City shows suggestions) → Save → the strip shows `ENT-…`;
      the printout shows Patient ID, OPD No., City, Occupation
- [ ] New prescription → **Find patient** → search by name / Patient ID / OPD No. / city →
      **Use this patient** → details filled; Save → "2 visits"
- [ ] Type the same name + city without Find → Save → **"Is this the same patient?"**,
      nothing saved; **Same patient** → linked; **No, register a new patient** → new ID;
      **Cancel** → nothing saved, form kept
- [ ] An OPD No. that belongs to another patient → message naming that patient
- [ ] **Past visits** → visits newest first, with the doctor; tap to expand
- [ ] A second doctor of the department sees the patient and all visits (History shows
      who wrote each); a doctor of another department sees none
- [ ] Dictate "OPD number 2 0 2 6 1 0 4 5, farmer from Bilaspur" → OPD No., Occupation,
      City proposed for review

## 6c. Department terms
- [ ] Medications: type "Tab. amox" → chips Amoxicillin, Amoxicillin–clavulanate; tap one →
      "Tab. Amoxicillin–clavulanate " and the keyboard stays open; go on with "625 mg …"
- [ ] Diagnosis: type "bppv" → the full name is offered; Escape hides the chips
- [ ] Dictate a medicine unclearly (or a name not on the list) → if the proposal names a
      drug that wasn't said, it shows **"Check the medicine"**; Accept all leaves it;
      hands-free "Accept" says it needs a look; its own Accept button works
- [ ] Dictate "BPPV right side" into Diagnosis → "Benign paroxysmal positional vertigo
      (BPPV) right side" (the side is kept)

## 6b. Ubuntu server
Follow `deploy/README.md` step 8 after any change in `deploy/`. With speech on the GPU:
the backend log says "Local Whisper large-v3 loaded on cuda" within a minute of a restart,
and the first dictation after a restart is as fast as the next ones.

## 7a. Tablet (Android, portrait and landscape)
- [ ] The mic stays at the bottom of the screen while scrolling; Print / Save are at the
      end of the form
- [ ] Dictate into a low field (e.g. Diagnosis) → the review panel comes into view by
      itself; scroll away → **Review N** in the dock brings it back
- [ ] Tap a low field (Advice) → the on-screen keyboard never hides it or the bar
- [ ] Rotate the tablet while the form is open → nothing is lost, nothing overlaps
- [ ] Phone 320–375 px with proposals waiting: mic, its status and Review fit in the dock

## 7b. Past prescriptions
- [ ] "View past prescriptions" opens the dialog; focus is inside; the page behind doesn't scroll
- [ ] Type part of a name (or a Reference ID) → list narrows; misspelling → "No matches…"
- [ ] Today / Last 7 days / All, and From/To dates narrow the list
- [ ] Arrow keys move between rows; Enter opens the focused one; Esc closes and focus
      returns to the button
- [ ] Pick a record → preview shows it; Print opens the normal print page
- [ ] Phone: list → preview → "Back to list"; ONE Print button, at the bottom
- [ ] Pop-ups blocked → message inside the dialog

## 8. Latency (through ngrok and on localhost)
Dictate one field; read the terminal:
`[timing] Groq transcription: …s for … KB audio` and `[timing] Gemini extraction (…): …s`.
Record: those two numbers, the wait you felt, with and without ngrok. If the felt wait ≫ the
sum, the gap is network. Repeat 5×; occasional 8s+ spikes among ~2s calls suggest silent
Gemini retries.

## 9. Demo-day checklist
- [ ] Mic permission and pop-ups granted beforehand
- [ ] Do not burn free-tier quota rehearsing the hour before
- [ ] Phone hotspot as a backup network
- [ ] PC will not sleep/lock; backend, the frontend and ngrok all running
- [ ] Serving the build (`npm run preview`, :4173)? Tunnel 4173 and **re-run `npm run build`
      after every change** — preview serves `dist/`, not the source
- [ ] Open the ngrok link yourself first (free tier shows an interstitial page)
- [ ] Use made-up patients — no real patient data until there is a login, encryption at
      rest and a consent/privacy review
- [ ] Let one wrong proposal happen and show Discard + redictate — it demonstrates the safety net
- [ ] Keep a log of every wrong proposal, verbatim (what was said → what was proposed): it
      becomes the material for improving the extraction prompt
