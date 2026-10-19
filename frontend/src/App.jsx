import { useState, useEffect, useRef } from "react";
import {
  User,
  ClipboardList,
  Pill,
  RotateCcw,
  Printer,
  Loader2,
  Search,
  NotebookPen,
  ListChecks,
  History as HistoryIcon,
  X,
} from "lucide-react";
import FormField from "./components/FormField.jsx";
import DictateBar from "./components/DictateBar.jsx";
import ReviewPanel from "./components/ReviewPanel.jsx";
import StatusBanner from "./components/StatusBanner.jsx";
import SaveButton from "./components/SaveButton.jsx";
import RecordsDialog from "./components/RecordsDialog.jsx";
import AccountsDialog from "./components/AccountsDialog.jsx";
import { FindPatientDialog, PatientHistoryDialog, SamePatientDialog } from "./components/PatientDialogs.jsx";
import { AppNavbar, SheetLetterhead, AppFooter } from "./components/Brand.jsx";
import { BRAND, loadLogoDataUri } from "./branding.js";
import { doctorDisplayName, doctorLetterhead } from "./doctor.js";
import { FIELD_SPECS, EMPTY_STATE } from "./fieldSpecs.js";
import { getVocabulary, saveForm } from "./api.js";
import {
  friendlyErrorMessage,
  PENDING_BEFORE_SAVE_MESSAGE,
  POPUP_BLOCKED_MESSAGE,
  SIGN_OUT_UNSAVED_MESSAGE,
  missingFieldsMessage,
} from "./messages.js";
import { localToday as today } from "./dates.js";
import { buildPrintHtml } from "./printTemplate.js";
import { mergePending, splitForAcceptAll, withPendingApplied } from "./pendingUpdates.js";

// Fields with typing suggestions, and which department list they use.
const SUGGESTIONS = { diagnosis: "diagnoses", medications: "medications" };

// micStatus key for the whole-visit mic (per-field mics use their field key).
const VISIT_MIC = "__visit";

// `profile`: the signed-in doctor (GET /api/auth/me) — see AuthGate.jsx.
export default function App({ profile, onSignOut }) {
  const [state, setState] = useState({ ...EMPTY_STATE, date: today() });
  const [pending, setPending] = useState([]);
  const [unmatchedNote, setUnmatchedNote] = useState("");
  const [transcriptLog, setTranscriptLog] = useState([]);
  const [micStatus, setMicStatusState] = useState({});
  const [savedPid, setSavedPid] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  // The patient this prescription is for, once known: picked with "Find
  // patient", chosen when the save asked "same patient?", or registered by
  // the save. Its summary (label = our Patient ID, visit count, ...).
  const [patient, setPatient] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // { candidates, print } while the save waits for "same patient?".
  const [samePatient, setSamePatient] = useState(null);
  // The department's terms for typing suggestions (Diagnosis, Medications);
  // without them the fields simply have no suggestions.
  const [vocabulary, setVocabulary] = useState(null);
  useEffect(() => {
    getVocabulary().then(setVocabulary).catch(() => {});
  }, []);
  // Logo as a data URI for the print page (a blank window can't load /aiims-logo.jpg).
  const [logo, setLogo] = useState("");
  useEffect(() => {
    loadLogoDataUri().then(setLogo);
  }, []);
  // Set by a Save/Print attempt with required fields empty; from then on the
  // missing fields are highlighted until filled (derived, so never stale).
  const [showMissing, setShowMissing] = useState(false);
  // Stable per-update ids (not array position) so accept/reject targets the
  // right item even when several updates are dispatched in one batch — see
  // handleVoiceUpdates and the multi-command voice parsing in ReviewPanel.
  const nextPendingId = useRef(0);
  // Set when a dictation brings new proposals: the review panel is then
  // scrolled into view if it isn't on screen (on a tablet the doctor may have
  // dictated into a field far below it).
  const revealReview = useRef(false);

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
    if (updates.length || note) revealReview.current = true;
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
    } else if (err.code === "validation" || err.code === "conflict") {
      // "conflict": e.g. that OPD No. belongs to another patient (named) — actionable too.
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

  // Items marked "check" (a doubtful medicine name) are left for the doctor
  // to accept one by one.
  const handleAcceptAll = () => {
    const { accept } = splitForAcceptAll(pending);
    accept.forEach(applyUpdate);
    setPending((prev) => splitForAcceptAll(prev).keep);
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

  const showReviewPanel = () => {
    const panel = document.querySelector(".review-panel");
    if (!panel) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    panel.querySelector(".review-accept, .accept-all")?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!revealReview.current) return;
    revealReview.current = false;
    const panel = document.querySelector(".review-panel");
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const footer = document.querySelector(".voice-dock")?.getBoundingClientRect();
    const bottomLimit = footer && footer.top < window.innerHeight ? footer.top : window.innerHeight;
    // Its top (heading + first proposal) must be visible; otherwise bring it in.
    if (r.top < 0 || r.top + 120 > bottomLimit) showReviewPanel();
  });

  const blockIfPending = () => {
    if (!pending.length) return false;
    setError(PENDING_BEFORE_SAVE_MESSAGE);
    return true;
  };

  // Required fields are checked here first so the doctor sees exactly which
  // fields to fill; the backend still validates as the source of truth.
  const missingFields = Object.keys(FIELD_SPECS).filter(
    (k) => FIELD_SPECS[k].required && !String(state[k] ?? "").trim()
  );
  const blockIfMissing = () => {
    if (!missingFields.length) return false;
    setShowMissing(true);
    return true;
  };

  const openPrintWindow = () => {
    const win = window.open("", "_blank");
    if (!win) {
      setError(POPUP_BLOCKED_MESSAGE);
      return null;
    }
    win.document.write(
      "<p style='font-family:Arial,sans-serif;padding:24px;color:#4a5b6b;'>Preparing print preview…</p>"
    );
    return win;
  };

  const writePrint = (win, pid, patientLabel) => {
    win.document.open();
    win.document.write(buildPrintHtml(state, pid, { letterhead, patientLabel }));
    win.document.close();
  };

  // Saves this visit for `link` ({ patientId } / { newPatient: true } / the
  // linked patient by default). If the save looks like a patient who is
  // already registered, nothing is saved: the doctor is asked first
  // (SamePatientDialog), then this runs again with their answer. `win`: an
  // already-open print window (opened in the click, before any await).
  const persist = async (link, win) => {
    const busy = win ? setPrinting : setSaving;
    busy(true);
    try {
      const res = await saveForm(state, transcriptLog.join("\n---\n"), link);
      setSavedPid(res.pid);
      setPatient(res.patient);
      if (win) writePrint(win, res.pid, res.patient.label);
    } catch (err) {
      win?.close();
      if (err.code === "possible_duplicate" && err.detail?.candidates?.length) {
        setSamePatient({ candidates: err.detail.candidates, print: !!win });
      } else {
        handleSaveError(err, win ? "print" : "save");
      }
    } finally {
      busy(false);
    }
  };

  const linkToPatient = () => (patient ? { patientId: patient.id } : {});

  const handleSave = () => {
    setError("");
    if (blockIfPending() || blockIfMissing()) return;
    persist(linkToPatient());
  };

  // The doctor's answer to "same patient?" — runs in the click, so a print
  // window can still be opened synchronously.
  const answerSamePatient = (link) => {
    const print = samePatient?.print;
    setSamePatient(null);
    const win = print ? openPrintWindow() : null;
    if (print && !win) return;
    persist(link, win);
  };

  // Picking an existing patient fills their details in (an explicit choice,
  // like typing them) and links the visit to their history.
  const pickPatient = (p) => {
    setFindOpen(false);
    setPatient(p);
    setState((s) => ({
      ...s,
      patient_name: p.full_name,
      gender: p.gender,
      occupation: p.occupation,
      city: p.city,
      opd_no: p.opd_no,
    }));
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
    if (!savedPid && (blockIfPending() || blockIfMissing())) return;
    const previewWindow = openPrintWindow();
    if (!previewWindow) return;
    if (savedPid) {
      writePrint(previewWindow, savedPid, patient?.label);
      return;
    }
    await persist(linkToPatient(), previewWindow);
  };

  const handleNewForm = () => {
    formGenRef.current += 1;
    setFormGen(formGenRef.current);
    setMicStatusState({});
    setShowMissing(false);
    setState({ ...EMPTY_STATE, date: today() });
    setPending([]);
    setUnmatchedNote("");
    setTranscriptLog([]);
    setSavedPid(null);
    setPatient(null);
    setSamePatient(null);
    setError("");
  };

  // Printed letterhead: institution seal + the signed-in doctor's details.
  const letterhead = doctorLetterhead(profile, logo, BRAND.institution);

  // Signing out drops the open form; don't let that happen by accident.
  const hasUnsavedWork =
    !locked &&
    (pending.length > 0 ||
      Object.entries(state).some(([k, v]) => k !== "date" && String(v ?? "").trim()));
  const handleSignOut = () => {
    if (hasUnsavedWork && !window.confirm(SIGN_OUT_UNSAVED_MESSAGE)) return;
    onSignOut();
  };

  const micsDisabled = !!cooldownUntil;
  const anyMicRecording = Object.values(micStatus).includes("recording");
  // Only one mic records at a time: two open mics would capture the same
  // speech twice and send two conflicting proposals.
  const otherMicRecording = (key) => anyMicRecording && micStatus[key] !== "recording";

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
    otherMicRecording: otherMicRecording(key),
    readOnly: locked,
    missing: showMissing && missingFields.includes(key),
    suggestions: SUGGESTIONS[key] ? vocabulary?.[SUGGESTIONS[key]] : undefined,
    suggestTrailingSpace: key === "medications",
  });

  const visibleMissing = showMissing ? missingFields : [];

  return (
    <div className="app-frame">
    <AppNavbar
      onHistory={() => setRecordsOpen(true)}
      onAccounts={profile?.doctor?.role === "admin" ? () => setAccountsOpen(true) : undefined}
      doctorName={doctorDisplayName(profile?.doctor?.full_name)}
      onSignOut={onSignOut && handleSignOut}
    />
    <main className="clinic-desk">
      {/* Keyed by form generation: "New prescription" remounts everything
          inside, so no mic, note or retry link survives into the next form. */}
      <article className="prescription-sheet" key={formGen}>
        <SheetLetterhead profile={profile} />
        <div className="sheet-stripe" aria-hidden="true" />

        {/* The writing pad: a white card under the doctor's card. */}
        <div className="sheet-pad">
        <div className="toolbar" role="group" aria-label="Form actions">
          <p className="help-text">Dictate the visit, review what was heard, then save.</p>
          <button type="button" className="quiet-button" onClick={handleNewForm}>
            <RotateCcw size={15} aria-hidden="true" />
            New prescription
          </button>
        </div>

        {savedPid && (
          <StatusBanner kind="saved" referenceId={savedPid} onNewPrescription={handleNewForm} />
        )}

        {visibleMissing.length > 0 && (
          <StatusBanner
            kind="error"
            message={missingFieldsMessage(visibleMissing.map((k) => FIELD_SPECS[k].label))}
          />
        )}

        {error && <StatusBanner kind="error" message={error} />}

        {cooldownUntil && <StatusBanner kind="cooldown" secondsLeft={remainingSeconds} />}

        {!locked && (
          <>
            <ReviewPanel
              pending={pending}
              unmatchedNote={unmatchedNote}
              onAccept={handleAccept}
              onReject={handleReject}
              onAcceptAll={handleAcceptAll}
              paused={anyMicRecording}
            />

            <p className="required-legend">
              Fields marked <span className="required">*</span> are required to save.
            </p>
          </>
        )}

        <section className="form-section">
          <div className="patient-heading-row">
            <h2 className="section-heading">
              <User size={17} aria-hidden="true" />
              <span>Patient information</span>
            </h2>
            {!locked && !patient && (
              <button type="button" className="records-button" onClick={() => setFindOpen(true)} aria-haspopup="dialog">
                <Search size={16} aria-hidden="true" />
                Find patient
              </button>
            )}
          </div>
          {patient && (
            <div className="patient-link" role="status">
              <span>
                <code>{patient.label}</code>{" "}
                {locked
                  ? `${patient.visit_count} visit${patient.visit_count === 1 ? "" : "s"}`
                  : `${patient.visit_count} earlier visit${patient.visit_count === 1 ? "" : "s"} · changes below update their record when saved`}
              </span>
              <span className="patient-link-actions">
                {patient.visit_count > 0 && (
                  <button type="button" className="records-button" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">
                    <HistoryIcon size={16} aria-hidden="true" />
                    Past visits
                  </button>
                )}
                {!locked && (
                  <button type="button" className="records-button" onClick={() => setPatient(null)}>
                    <X size={16} aria-hidden="true" />
                    Not this patient
                  </button>
                )}
              </span>
            </div>
          )}
          <div className="field-grid patient-grid">
            <FormField {...commonFieldProps("patient_name")} />
            <FormField {...commonFieldProps("opd_no")} />
            <FormField {...commonFieldProps("date")} />
            <FormField {...commonFieldProps("age")} />
            <FormField {...commonFieldProps("gender")} />
            <FormField {...commonFieldProps("city")} />
            <FormField {...commonFieldProps("occupation")} />
          </div>
        </section>

        <div className="rx-divider" aria-hidden="true">
          <span className="rx-mark">℞</span>
        </div>

        <section className="form-section">
          <h2 className="section-heading">
            <ClipboardList size={17} aria-hidden="true" />
            <span>Clinical assessment</span>
          </h2>
          <div className="field-grid clinical-grid">
            <FormField {...commonFieldProps("chief_complaints")} />
            <FormField {...commonFieldProps("on_examination")} />
            <FormField {...commonFieldProps("diagnosis")} />
            <FormField {...commonFieldProps("investigation")} />
          </div>
        </section>

        <section className="form-section">
          <h2 className="section-heading">
            <Pill size={17} aria-hidden="true" />
            <span>Medications</span>
          </h2>
          <FormField {...commonFieldProps("medications")} />
        </section>

        <section className="form-section">
          <h2 className="section-heading">
            <NotebookPen size={17} aria-hidden="true" />
            <span>Advice</span>
          </h2>
          <FormField {...commonFieldProps("advice")} />
        </section>

        {/* Print / Save at the end of the form, like signing a paper pad. */}
        <footer className="form-footer">
          <button
            type="button"
            className="action-button secondary"
            onClick={handlePrint}
            disabled={printing || saving}
            aria-label={printing ? "Preparing…" : "Print"}
          >
            {printing ? (
              <Loader2 size={17} className="spin" aria-hidden="true" />
            ) : (
              <Printer size={17} aria-hidden="true" />
            )}
            <span className="print-label">{printing ? "Preparing…" : "Print"}</span>
          </button>
          <SaveButton
            phase={saving ? "saving" : locked ? "saved" : "unsaved"}
            onSave={handleSave}
            disabled={printing}
          />
        </footer>
        </div>

        {/* The whole-visit mic floats at the bottom of the screen, always
            within reach while the form scrolls; "Review N" beside it when
            proposals wait. Gone once the prescription is saved. */}
        {!locked && (
          <div className="voice-dock">
            <DictateBar
              formState={extractionBase}
              onVoiceUpdates={handleVoiceUpdates}
              onVoiceError={handleApiError}
              onRecordingChange={(recording) =>
                setMicStatus(VISIT_MIC, recording ? "recording" : null)
              }
              disabled={micsDisabled}
              otherMicRecording={otherMicRecording(VISIT_MIC)}
            />
            {pending.length > 0 && (
              <button
                type="button"
                className="action-button secondary review-jump"
                onClick={showReviewPanel}
                aria-label={`Review ${pending.length} proposed change${pending.length === 1 ? "" : "s"}`}
              >
                <ListChecks size={17} aria-hidden="true" />
                <span className="review-jump-label">Review</span>
                <span className="review-jump-count">{pending.length}</span>
              </button>
            )}
          </div>
        )}
      </article>
      {findOpen && <FindPatientDialog onPick={pickPatient} onClose={() => setFindOpen(false)} />}
      {historyOpen && patient && (
        <PatientHistoryDialog patientId={patient.id} onClose={() => setHistoryOpen(false)} />
      )}
      {samePatient && (
        <SamePatientDialog
          candidates={samePatient.candidates}
          patientName={state.patient_name}
          onChoose={answerSamePatient}
          onClose={() => setSamePatient(null)}
        />
      )}
      {accountsOpen && (
        <AccountsDialog
          onClose={() => setAccountsOpen(false)}
          currentEmail={profile?.doctor?.email}
          departmentName={profile?.department?.name}
        />
      )}
      {recordsOpen && (
        <RecordsDialog letterhead={letterhead} onClose={() => setRecordsOpen(false)} />
      )}
    </main>
    <AppFooter />
    </div>
  );
}
