import { useState, useEffect } from "react";
import { Mic, Square, Loader2, RefreshCw } from "lucide-react";
import { useRecorder } from "../useRecorder.js";
import { transcribeAudio, extractFields } from "../api.js";
import { friendlyErrorMessage, EMPTY_TRANSCRIPT_MESSAGE, noMatchMessage } from "../messages.js";

const IDLE_STATUS = "Tap the mic and describe the visit.";
const PAUSED_STATUS = "Voice input is paused for a moment — see the note above.";

export default function DictateBar({
  formState,
  onVoiceUpdates,
  onVoiceError,
  onRecordingChange,
  disabled,
  otherMicRecording,
}) {
  const { isRecording, start, stop } = useRecorder();
  const [status, setStatus] = useState(IDLE_STATUS);
  const [busy, setBusy] = useState(false);
  // Kept only when extraction (not transcription) fails, so "Retry" can reuse
  // speech-to-text that already succeeded instead of making the doctor
  // redictate the whole visit just because the second step hiccuped.
  const [lastTranscript, setLastTranscript] = useState(null);

  useEffect(() => {
    if (disabled) setStatus(PAUSED_STATUS);
    // When the pause ends, don't leave "paused" showing.
    else setStatus((prev) => (prev === PAUSED_STATUS ? IDLE_STATUS : prev));
  }, [disabled]);

  // Lets the page pause hands-free confirm while this mic is open, so
  // dictated words ("confirm", "remove", "wrong") aren't taken as commands.
  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording]); // eslint-disable-line react-hooks/exhaustive-deps

  const runExtraction = async (transcript) => {
    setStatus("Filling in the prescription…");
    try {
      const result = await extractFields(transcript, formState, null);
      setLastTranscript(null); // succeeded — nothing left to retry
      onVoiceUpdates(result.updates, transcript, result.unmatched_transcript_note);
      setStatus(
        result.updates.length
          ? `Found ${result.updates.length} detail${result.updates.length > 1 ? "s" : ""} to review.`
          : noMatchMessage()
      );
    } catch (err) {
      onVoiceError(err);
      setStatus(friendlyErrorMessage(err));
      // lastTranscript deliberately left set so Retry can reuse it
    }
  };

  const handleToggle = async () => {
    if (busy) return;
    // A cooldown blocks starting, never stopping: an open mic must be closable.
    if (!isRecording && (disabled || otherMicRecording)) return;

    if (isRecording) {
      setBusy(true);
      setStatus("Listening back to what you said…");
      const blob = await stop();

      let transcript;
      try {
        transcript = await transcribeAudio(blob);
      } catch (err) {
        onVoiceError(err);
        setStatus(friendlyErrorMessage(err));
        setBusy(false);
        return;
      }

      if (!transcript.trim()) {
        setStatus(EMPTY_TRANSCRIPT_MESSAGE);
        setBusy(false);
        return;
      }

      setLastTranscript(transcript);
      await runExtraction(transcript);
      setBusy(false);
    } else {
      setLastTranscript(null); // starting fresh supersedes any pending retry
      try {
        if (!(await start())) return;
      } catch (err) {
        onVoiceError(err);
        setStatus(friendlyErrorMessage(err));
        return;
      }
      setStatus("Describe the visit, then tap the mic to stop.");
    }
  };

  const handleRetry = async () => {
    if (!lastTranscript || busy || disabled) return;
    setBusy(true);
    await runExtraction(lastTranscript);
    setBusy(false);
  };

  // Spacebar toggles the same start/stop as clicking the mic — but only when
  // the doctor isn't actively typing somewhere else on the form. Without this
  // guard, pressing space while typing a note ("chest pain") would toggle
  // recording instead of typing a space character.
  // A focused button or link is also left alone: Space already activates it,
  // so handling it here too would fire twice (e.g. start dictation AND
  // "New prescription"). If the focused button is this mic, its own click
  // does the toggle.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== "Space") return;
      if (e.repeat) return; // ignore the key-repeat that fires while held down

      const active = document.activeElement;
      const tag = active?.tagName;
      const isTypingTarget =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable;
      const isActivatable = tag === "BUTTON" || tag === "A";
      if (isTypingTarget || isActivatable) return;

      e.preventDefault(); // stop the page from scrolling on a bare Space press
      handleToggle();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // One visual state: idle | recording | processing | paused.
  // "paused" = can't start now: a cooldown, or a field mic is recording
  // (only one mic records at a time).
  const state = busy
    ? "processing"
    : isRecording
    ? "recording"
    : disabled || otherMicRecording
    ? "paused"
    : "idle";

  const icon =
    state === "processing" ? (
      <Loader2 size={23} className="spin" aria-hidden="true" />
    ) : state === "recording" ? (
      <Square size={20} fill="currentColor" aria-hidden="true" />
    ) : (
      <Mic size={23} aria-hidden="true" />
    );

  // Lives in the bottom dock (App.jsx), always within reach.
  return (
    <div className={`dictate-bar dictate-${state}`}>
      <button
        type="button"
        className="dictate-button"
        onClick={handleToggle}
        disabled={state === "processing" || state === "paused"}
        aria-label={isRecording ? "Stop dictating the visit" : "Dictate the whole visit"}
        title={isRecording ? "Stop and fill in the prescription (Space)" : "Dictate the whole visit (Space)"}
      >
        {icon}
      </button>
      <div className="dictate-copy">
        <div className="dictate-title">
          <strong>{state === "recording" ? "Listening…" : "Dictate the visit"}</strong>
          {/* Shown only where there is a keyboard (see styles.css). */}
          <kbd>Space</kbd>
          {/* Moves only while the mic is actually open (never when idle). */}
          {state === "recording" && (
            <span className="dictate-wave" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} />
              ))}
            </span>
          )}
        </div>
        <div className="dictate-status" aria-live="polite" title={status}>
          {status}
        </div>
        {lastTranscript && !busy && (
          <button
            type="button"
            className="retry-button"
            onClick={handleRetry}
            disabled={disabled}
            aria-label="Try filling in the prescription again. No need to redictate."
          >
            <RefreshCw size={14} aria-hidden="true" />
            Try again (no need to redictate)
          </button>
        )}
      </div>
    </div>
  );
}
