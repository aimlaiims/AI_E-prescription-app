import { useState, useEffect, useRef } from "react";
import { User, ClipboardList, Pill, Copy, Check, AlertTriangle, Clock3, RotateCcw, Save, Printer, History } from "lucide-react";
import FormField from "./components/FormField.jsx";
import DictateBar from "./components/DictateBar.jsx";
import ReviewPanel from "./components/ReviewPanel.jsx";
import { FIELD_SPECS, EMPTY_STATE } from "./fieldSpecs.js";
import { saveForm } from "./api.js";
import {
  friendlyErrorMessage,
  friendlyCooldownReason,
  PENDING_BEFORE_SAVE_MESSAGE,
} from "./messages.js";
import { buildPrintHtml } from "./printTemplate.js";
import { mergePending, withPendingApplied } from "./pendingUpdates.js";

// micStatus key for the whole-visit mic (per-field mics use their field key).
const VISIT_MIC = "__visit";

// Today's date as YYYY-MM-DD in the *local* timezone. toISOString() is UTC,
// which in India gives yesterday's date until 5:30 am.
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function App() {
  const [state, setState] = useState({ ...EMPTY_STATE, date: today() });
  const [pending, setPending] = useState([]);
  const [unmatchedNote, setUnmatchedNote] = useState("");
  const [transcriptLog, setTranscriptLog] = useState([]);
  const [micStatus, setMicStatusState] = useState({});
  const [savedPid, setSavedPid] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [oldRecordsNote, setOldRecordsNote] = useState(false);
  const oldRecordsTimeout = useRef(null);
  // Stable per-update ids (not array position) so accept/reject targets the
  // right item even when several updates are dispatched in one batch — see
  // handleVoiceUpdates and the multi-command voice parsing in ReviewPanel.
  const nextPendingId = useRef(0);

  // A saved prescription is final (ROADMAP P0-1, "lock after save"): no
  // typing, no dictation, no review. Print then always matches the stored
  // record. Changing anything means starting a new prescription.
  const locked = !!savedPid;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Bumped by "New prescription". Voice results and errors from requests
  // started for an earlier form are dropped, so a previous patient's
  // dictation can never appear on the next patient's form. Also used as a
  // React key so every mic, note and retry link starts fresh.
  const [formGen, setFormGen] = useState(0);
  const formGenRef = useRef(formGen);
  // Latest real form values, readable from async voice callbacks.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Rate limiting is a property of the shared voice-service connection, not
  // whichever mic happened to trigger it — the cooldown disables every mic on
  // the page, not just the one that hit it.
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setRemainingSeconds(secs);
      if (secs <= 0) setCooldownUntil(null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const setMicStatus = (field, status) =>
    setMicStatusState((prev) => ({ ...prev, [field]: status }));

  const handleFieldChange = (field, value) => {
    setState((prev) => ({ ...prev, [field]: value }));
  };

  // Components keep the handler from the render in which the request started,
  // so `formGen` here is the generation that request belongs to.
  const handleVoiceUpdates = (updates, transcript, note) => {
    if (formGen !== formGenRef.current) return;
    // A per-field request can still be in flight when Save completes; its
    // result must not reopen a finalized record.
    if (lockedRef.current) return;
    setError(""); // a working voice request supersedes an earlier failure
    if (transcript) setTranscriptLog((prev) => [...prev, transcript]);
    if (note) setUnmatchedNote(note);
    if (updates.length) {
      // One pending item per field: a newer proposal supersedes an older one
      // (ROADMAP P0-4). Ids are stable, never array positions.
      setPending((prev) =>
        mergePending(prev, updates, stateRef.current, () => `u${nextPendingId.current++}`)
      );
    }
  };

  // Central place every mic's catch block reports failures to. This is what
  // guarantees a failed voice request only ever produces a banner or a
  // cooldown — never something that lands in a field as if it were real data.
  const handleApiError = (err) => {
    if ((err?.code || "unknown") === "rate_limited") {
      // Applies whichever form the request was for: the quota is shared.
      const seconds = err.retryAfter || 20;
      setCooldownUntil(Date.now() + seconds * 1000);
      return;
    }
    if (formGen !== formGenRef.current) return;
    setError(friendlyErrorMessage(err));
  };

  // Save/Print failures are a different category from voice failures: a
  // "validation" error (missing required fields) is real, doctor-actionable
  // text from our own backend, not a voice-service problem to soften — show
  // it directly rather than routing it through the voice-specific messages.
  // `context` ("save" or "print") keeps the fallback wording accurate too —
  // these failures have nothing to do with the microphone, so they shouldn't
  // read as if they do.
  const handleSaveError = (err, context) => {
    if (err.code === "rate_limited") {
      handleApiError(err);
    } else if (err.code === "validation") {
      setError(err.message);
    } else {
      setError(friendlyErrorMessage(err, context));
    }
  };

  const applyUpdate = (update) => {
    setState((prev) => ({ ...prev, [update.field]: update.new_value }));
  };

  const handleAccept = (id) => {
    const update = pending.find((u) => u.id === id);
    if (!update) return;
    applyUpdate(update);
    setPending((prev) => prev.filter((u) => u.id !== id));
  };

  const handleReject = (id) => {
    setPending((prev) => prev.filter((u) => u.id !== id));
  };

  const handleAcceptAll = () => {
    pending.forEach(applyUpdate);
    setPending([]);
  };

  // Unreviewed proposals would otherwise be silently left out of a record
  // that can no longer be changed — make the doctor decide on them first.
  // Once the doctor has dealt with every proposal, the "still waiting for
  // review" banner is no longer true.
  useEffect(() => {
    if (!pending.length) {
      setError((prev) => (prev === PENDING_BEFORE_SAVE_MESSAGE ? "" : prev));
    }
  }, [pending.length]);

  const blockIfPending = () => {
    if (!pending.length) return false;
    setError(PENDING_BEFORE_SAVE_MESSAGE);
    return true;
  };

  const handleSave = async () => {
    setError("");
    if (blockIfPending()) return;
    setSaving(true);
    try {
      const res = await saveForm(state, transcriptLog.join("\n---\n"));
      setSavedPid(res.pid);
    } catch (err) {
      handleSaveError(err, "save");
    } finally {
      setSaving(false);
    }
  };

  // Print saves the record first if it hasn't been saved yet (a printed
  // prescription should always have a traceable Reference ID), then opens a
  // formatted preview in a new tab. The tab is opened synchronously, before
  // any `await`, and reused for the content once ready — opening a window
  // *after* an await is what gets silently blocked by popup blockers, since
  // it's no longer seen as a direct result of the click.
  // Once saved, the form is locked (see `locked`), so printing a saved record
  // always prints exactly what is stored.
  const handlePrint = async () => {
    setError("");
    if (!savedPid && blockIfPending()) return;
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setError("Your browser blocked the print preview pop-up. Please allow pop-ups for this page and try again.");
      return;
    }
    previewWindow.document.write(
      "<p style='font-family:Arial,sans-serif;padding:24px;color:#4a5b6b;'>Preparing print preview…</p>"
    );

    let pid = savedPid;
    if (!pid) {
      setPrinting(true);
      try {
        const res = await saveForm(state, transcriptLog.join("\n---\n"));
        pid = res.pid;
        setSavedPid(pid);
      } catch (err) {
        previewWindow.close();
        handleSaveError(err, "print");
        setPrinting(false);
        return;
      }
      setPrinting(false);
    }

    const html = buildPrintHtml(state, pid);
    previewWindow.document.open();
    previewWindow.document.write(html);
    previewWindow.document.close();
  };

  const handleNewForm = () => {
    formGenRef.current += 1;
    setFormGen(formGenRef.current);
    setMicStatusState({});
    setState({ ...EMPTY_STATE, date: today() });
    setPending([]);
    setUnmatchedNote("");
    setTranscriptLog([]);
    setSavedPid(null);
    setCopied(false);
    setError("");
  };

  const handleCopyPid = async () => {
    if (!savedPid) return;
    try {
      await navigator.clipboard.writeText(savedPid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard access denied — the ID is still visible to copy by hand */
    }
  };

  // Placeholder until the real record browser is built — the backend already
  // lists saved forms (GET /api/forms), so this becomes a UI-only task later.
  const handleViewOldRecords = () => {
    setOldRecordsNote(true);
    clearTimeout(oldRecordsTimeout.current);
    oldRecordsTimeout.current = setTimeout(() => setOldRecordsNote(false), 4000);
  };

  const micsDisabled = !!cooldownUntil;
  const anyMicRecording = Object.values(micStatus).includes("recording");

  // Dictation is interpreted against the form *with pending proposals
  // applied*, so "add ..." after an unreviewed proposal builds on it instead
  // of on the stale value underneath (ROADMAP P0-4).
  const extractionBase = withPendingApplied(state, pending);

  const commonFieldProps = (key) => ({
    fieldKey: key,
    spec: FIELD_SPECS[key],
    value: state[key],
    onChange: handleFieldChange,
    onVoiceUpdates: handleVoiceUpdates,
    onVoiceError: handleApiError,
    formState: extractionBase,
    micStatus: micStatus[key],
    setMicStatus,
    disabled: micsDisabled,
    readOnly: locked,
  });

  return (
    <div className="app-shell">
      <div className="paper">
        <header className="pad-header">
          <div className="pad-header-title">
            <span className="rx-mark">℞</span>
            <div>
              <h1>Clinical Voice Form</h1>
              <p className="pad-header-subtitle">
                Dictate the visit, review what was heard, then save.
              </p>
            </div>
          </div>
        </header>

        <div className="toolbar-row">
          <div className="toolbar-item">
            <button className="btn subtle" onClick={handleViewOldRecords}>
              <History size={15} />
              View past prescriptions
            </button>
            {oldRecordsNote && (
              <div className="toolbar-note">
                Coming soon — saved prescriptions are already stored and will be
                searchable here in a future update.
              </div>
            )}
          </div>
          <button className="btn subtle" onClick={handleNewForm}>
            <RotateCcw size={15} />
            New prescription
          </button>
        </div>

        <div className="pad-body" key={formGen}>
          {savedPid && (
            <div className="saved-banner">
              <div className="saved-banner-text">
                <Check size={18} strokeWidth={2.5} />
                <span>
                  Prescription saved. Reference ID{" "}
                  <button type="button" className="pid-copy" onClick={handleCopyPid}>
                    <span className="pid">{savedPid}</span>
                    <Copy size={13} />
                    {copied && <span className="pid-copied">Copied</span>}
                  </button>
                  <span className="saved-banner-note">
                    This prescription is now final. To make a change, start a new
                    prescription.
                  </span>
                </span>
              </div>
              <button className="btn" onClick={handleNewForm}>
                <RotateCcw size={15} />
                Start a new prescription
              </button>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <AlertTriangle size={17} strokeWidth={2.2} />
              <span>{error}</span>
            </div>
          )}

          {cooldownUntil && (
            <div className="cooldown-banner">
              <Clock3 size={18} strokeWidth={2.2} />
              <div className="cooldown-text">
                <strong>Voice input is taking a short break</strong>
                <div className="cooldown-reason">{friendlyCooldownReason()}</div>
              </div>
              <span className="cooldown-timer">{remainingSeconds}s</span>
            </div>
          )}

          {!locked && (
            <>
              <DictateBar
                formState={extractionBase}
                onVoiceUpdates={handleVoiceUpdates}
                onVoiceError={handleApiError}
                onRecordingChange={(recording) =>
                  setMicStatus(VISIT_MIC, recording ? "recording" : null)
                }
                disabled={micsDisabled}
              />

              <ReviewPanel
                pending={pending}
                unmatchedNote={unmatchedNote}
                onAccept={handleAccept}
                onReject={handleReject}
                onAcceptAll={handleAcceptAll}
                paused={anyMicRecording}
              />

              <p className="required-legend">
                Fields marked <span className="req">*</span> are required to save.
              </p>
            </>
          )}

          <section className="section">
            <h2 className="section-label">
              <User size={16} strokeWidth={2.2} />
              Patient information
            </h2>
            <div className="field-row">
              <FormField {...commonFieldProps("patient_name")} />
              <FormField {...commonFieldProps("date")} />
            </div>
            <div className="field-row">
              <FormField {...commonFieldProps("age")} />
              <FormField {...commonFieldProps("gender")} />
            </div>
          </section>

          <section className="section">
            <h2 className="section-label">
              <ClipboardList size={16} strokeWidth={2.2} />
              Clinical assessment
            </h2>
            <FormField {...commonFieldProps("chief_complaints")} />
            <FormField {...commonFieldProps("on_examination")} />
            <FormField {...commonFieldProps("diagnosis")} />
            <FormField {...commonFieldProps("investigation")} />
          </section>

          <section className="section">
            <h2 className="section-label">
              <Pill size={16} strokeWidth={2.2} />
              Medications
            </h2>
            <FormField {...commonFieldProps("medications")} />
          </section>
        </div>

        <footer className="footer-actions">
          <button className="btn" onClick={handlePrint} disabled={printing || saving}>
            <Printer size={16} />
            {printing ? "Preparing…" : "Print"}
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving || printing || locked}>
            {locked ? <Check size={16} /> : <Save size={16} />}
            {saving ? "Saving…" : locked ? "Saved" : "Save prescription"}
          </button>
        </footer>
      </div>
    </div>
  );
}