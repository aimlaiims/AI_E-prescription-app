import { useState, useEffect } from "react";
import { Mic, Square, Loader2, RefreshCw } from "lucide-react";
import { useRecorder } from "../useRecorder.js";
import { transcribeAudio, extractFields } from "../api.js";
import { friendlyErrorMessage, EMPTY_TRANSCRIPT_MESSAGE, noMatchMessage } from "../messages.js";

export default function DictateBar({ formState, onVoiceUpdates, onVoiceError, disabled }) {
  const { isRecording, start, stop } = useRecorder();
  const [status, setStatus] = useState("Tap the mic or press Space and describe the visit.");
  const [busy, setBusy] = useState(false);
  // Kept only when extraction (not transcription) fails, so "Retry" can reuse
  // speech-to-text that already succeeded instead of making the doctor
  // redictate the whole visit just because the second step hiccuped.
  const [lastTranscript, setLastTranscript] = useState(null);

  useEffect(() => {
    if (disabled) setStatus("Voice input is paused for a moment — see the note above.");
  }, [disabled]);

  const runExtraction = async (transcript) => {
    setStatus("Filling in the prescription…");
    try {
      const result = await extractFields(transcript, formState, null);
      setLastTranscript(null); // succeeded — nothing left to retry
      onVoiceUpdates(result.updates, transcript, result.unmatched_transcript_note);
      setStatus(
        result.updates.length
          ? `Found ${result.updates.length} detail${result.updates.length > 1 ? "s" : ""} to review below.`
          : noMatchMessage()
      );
    } catch (err) {
      onVoiceError(err);
      setStatus(friendlyErrorMessage(err));
      // lastTranscript deliberately left set so Retry can reuse it
    }
  };

  const handleToggle = async () => {
    if (disabled || busy) return;

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
        await start();
      } catch (err) {
        onVoiceError(err);
        setStatus(friendlyErrorMessage(err));
        return;
      }
      setStatus("Listening. Describe the visit, then tap the mic or press Space to stop.");
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
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== "Space") return;
      if (e.repeat) return; // ignore the key-repeat that fires while held down

      const active = document.activeElement;
      const tag = active?.tagName;
      const isTypingTarget =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable;
      if (isTypingTarget) return;

      e.preventDefault(); // stop the page from scrolling on a bare Space press
      handleToggle();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const icon = busy ? (
    <Loader2 size={22} className="spin" />
  ) : isRecording ? (
    <Square size={18} />
  ) : (
    <Mic size={22} />
  );

  return (
    <div className="dictate-bar">
      <button
        type="button"
        className={`dictate-mic-btn ${isRecording ? "recording" : ""} ${busy ? "processing" : ""}`}
        onClick={handleToggle}
        disabled={busy || disabled}
        aria-label={isRecording ? "Stop dictating the visit" : "Dictate the whole visit"}
        title={isRecording ? "Stop and fill in the prescription (Space)" : "Dictate the whole visit (Space)"}
      >
        {icon}
      </button>
      <div className="dictate-bar-text">
        <span className="dictate-bar-label">Dictate the whole visit</span>
        <span className="status-text">{status}</span>
        {lastTranscript && !busy && (
          <button type="button" className="retry-link" onClick={handleRetry} disabled={disabled}>
            <RefreshCw size={12} />
            Try filling in the prescription again. No need to redictate.
          </button>
        )}
      </div>
    </div>
  );
}
