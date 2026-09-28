# Testing

There is no automated test suite yet (ROADMAP P1-4). Until there is, this file is the test
plan. Automated checks that do exist: `npm run build`, the backend import check, and
`node scripts/verify-changes.mjs` (static — proves code is present, not that it behaves).

Run the manual tests on the machine and browser that will be used for the demo
(**Chrome or Edge**), including once **through the ngrok URL**.

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

## 4. Voice confirm and Space
Get 4–5 proposals pending (Case 1 works), toggle **Hands-free**.
- [ ] "accept" → top item only
- [ ] "accept diagnosis" → that item
- [ ] **"accept age"** → age (fixed P0-2; was the top item)
- [ ] **"accept exam"** → on examination (fixed P0-2)
- [ ] mumbled/nonsense field name → nothing accepted, amber "Didn't catch which item" notice
- [ ] top item shows a **Next** tag while hands-free is on; bare "accept" acts on it
- [ ] "accept diagnosis accept medications accept all" in one breath → all three act
- [ ] "no wait let me check the chart" → nothing happens (false-positive guard)
- [ ] "except all" → treated as "accept all"
- [ ] dot pulses when listening; goes dim briefly on reconnect
- [ ] Click **Accept**/**Discard** buttons → same result as voice

Space (whole-visit mic):
- [ ] Nothing focused, press Space → recording starts; again → stops; page does not scroll
- [ ] Focus in any text field, type a sentence with spaces → types normally, never toggles
- [ ] Hold Space → one toggle, not a stream
- [ ] **Click the mic with the mouse, then press Space** → toggles once, not twice (P0-2d)
- [ ] **Click Print, return to the tab, press Space** → does not re-trigger Print (P0-2d)

## 5. Failure paths (simulate — do not wait for a real outage)
Confirm for each: a banner or cooldown appears, **no field changes**, no service name,
status code or ".env" is visible.

| Simulate | How | Expect |
|---|---|---|
| Bad Gemini key | set `GEMINI_API_KEY=x`, restart backend | "not set up correctly" message |
| Bad Groq key | set `GROQ_API_KEY=x` | same |
| Network off | disable Wi-Fi mid-dictation | generic "interrupted" message + retry link if transcript existed |
| Rate limit (UI) | temporarily add `raise UpstreamError("x", code="rate_limited", retry_after=12)` at the top of `extract()` in `voice.py` | amber banner, **all** mics disabled, countdown, mics return at 0 |
| 503 | temporarily raise `UpstreamError("x", code="unavailable")` | error banner + "Try filling in the form again" link; link works once the raise is removed |
| Missing required fields | Save/Print with empty form | "Please fill in: …" with **field labels** |

Backend-only pattern (also the seed for pytest):
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

## 7. Responsive and visual
Check at 375px, 768px, 1280px:
- [ ] 375: edge-to-edge, sticky Print/Save bar, last field not hidden behind it, patient
      fields stack, no horizontal scroll, inputs do not zoom on focus (iOS)
- [ ] 768/1280: bordered sheet, footer inline at the bottom of the sheet
- [ ] Dictate bar, banners and review panel wrap cleanly
- [ ] Tap targets ≥ 44px; recording state (maroon pulse) and processing spinner visible

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
- [ ] PC will not sleep/lock; backend, `npm run dev` and ngrok all running
- [ ] Open the ngrok link yourself first (free tier shows an interstitial page)
- [ ] Say up front: "View old records" is not built yet
- [ ] Let one wrong proposal happen and show Discard + redictate — it demonstrates the safety net
