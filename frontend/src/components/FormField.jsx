import { useState, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { useRecorder } from "../useRecorder.js";
import { transcribeAudio, extractFields } from "../api.js";
import { EMPTY_TRANSCRIPT_MESSAGE, noMatchMessage } from "../messages.js";

export default function FormField({
  fieldKey,
  spec,
  value,
  onChange,
  onVoiceUpdates,
  onVoiceError,
  formState,
  micStatus,
  setMicStatus,
  disabled,
  readOnly,
}) {
  const { isRecording, start, stop } = useRecorder();

  // If the form locks (saved) while this mic is recording, switch the mic
  // off and throw the audio away — a finalized record takes no more input.
  useEffect(() => {
    if (readOnly && isRecording) {
      stop().then(() => setMicStatus(fieldKey, null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, isRecording]);

  // A transient note for outcomes that aren't errors (nothing heard, nothing
  // relevant found) — these go through the shared onVoiceError banner instead
  // only when they're real failures, not benign empty results.
  const [note, setNote] = useState(null);

  const handleMicClick = async () => {
    if (disabled || readOnly) return;

    if (isRecording) {
      setMicStatus(fieldKey, "processing");
      setNote(null);
      const blob = await stop();
      try {
        const transcript = await transcribeAudio(blob);
        if (!transcript.trim()) {
          setNote(EMPTY_TRANSCRIPT_MESSAGE);
          return;
        }
        const result = await extractFields(transcript, formState, fieldKey);
        if (result.updates.length === 0) {
          setNote(noMatchMessage(spec.label));
        } else {
          onVoiceUpdates(result.updates, transcript, result.unmatched_transcript_note);
        }
      } catch (err) {
        // Report failures through the shared handler — never fold them into
        // onVoiceUpdates as if they were a real (if odd) transcript result.
        onVoiceError(err);
      } finally {
        setMicStatus(fieldKey, null);
      }
    } else {
      setNote(null);
      try {
        if (!(await start())) return;
      } catch (err) {
        onVoiceError(err);
        return;
      }
      setMicStatus(fieldKey, "recording");
    }
  };

  const inputClasses = "field-input";
  const isProcessing = micStatus === "processing";

  return (
    <div className={`field ${fieldKey}`}>
      <label htmlFor={fieldKey}>
        {spec.label}
        {spec.required && <span className="req"> *</span>}
      </label>
      <div className="field-input-wrap">
        {spec.type === "textarea" && (
          <textarea
            id={fieldKey}
            className={inputClasses}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          />
        )}
        {spec.type === "text" && (
          <input
            id={fieldKey}
            type="text"
            className={inputClasses}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          />
        )}
        {spec.type === "date" && (
          <input
            id={fieldKey}
            type="date"
            className={inputClasses}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          />
        )}
        {spec.type === "enum" && (
          <select
            id={fieldKey}
            className={inputClasses}
            value={value}
            disabled={readOnly}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          >
            <option value="">Select…</option>
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        {!readOnly && (
          <button
            type="button"
            className={`mic-btn ${isRecording ? "recording" : ""} ${isProcessing ? "processing" : ""}`}
            onClick={handleMicClick}
            disabled={disabled}
            aria-label={
              isRecording ? `Stop and fill in ${spec.label}` : `Dictate ${spec.label}`
            }
            title={
              disabled
                ? "Voice input is paused for a moment"
                : isRecording
                ? "Stop and fill in this field"
                : `Dictate ${spec.label}`
            }
          >
            {isProcessing ? (
              <Loader2 size={16} className="spin" />
            ) : isRecording ? (
              <Square size={14} />
            ) : (
              <Mic size={16} />
            )}
          </button>
        )}
      </div>
      {note && <p className="field-mic-note">{note}</p>}
    </div>
  );
}
