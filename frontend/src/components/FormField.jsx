import { useState, useEffect, useRef } from "react";
import { Mic, Square, Loader2, ChevronDown } from "lucide-react";
import { useRecorder } from "../useRecorder.js";
import { transcribeAudio, extractFields } from "../api.js";
import { EMPTY_TRANSCRIPT_MESSAGE, noMatchMessage } from "../messages.js";
import { CITIES } from "../cities.js";
import { applyTerm, currentLine, matchTerms } from "../suggest.js";
import TermSuggestions from "./TermSuggestions.jsx";

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
  otherMicRecording,
  readOnly,
  missing,
  // Department terms for typing suggestions (textarea fields only), and
  // whether a chosen term is followed by a space (medicines: the strength).
  suggestions,
  suggestTrailingSpace = false,
}) {
  const { isRecording, start, stop } = useRecorder();

  // Typing suggestions: shown while the field has focus and the caret's line
  // matches department terms.
  const textareaRef = useRef(null);
  const [caret, setCaret] = useState(null); // null = not focused / hidden
  const suggested =
    suggestions && caret !== null && !readOnly
      ? matchTerms(suggestions, currentLine(value, caret).fragment)
      : [];
  const trackCaret = (e) => setCaret(e.target.selectionStart);
  const pickTerm = (term) => {
    const next = applyTerm(value, caret ?? value.length, term, { trailingSpace: suggestTrailingSpace });
    onChange(fieldKey, next.value);
    setCaret(null); // hidden until typing again
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

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
    if (readOnly) return;
    // A cooldown or another open mic blocks STARTING, never stopping.
    if (!isRecording && (disabled || otherMicRecording)) return;

    if (isRecording) {
      setMicStatus(fieldKey, "processing");
      setNote(null);
      const blob = await stop();
      try {
        const transcript = await transcribeAudio(blob, fieldKey);
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

  // One visual state for the mic: idle | recording | processing | disabled.
  const micState =
    micStatus === "processing"
      ? "processing"
      : isRecording
      ? "recording"
      : disabled || otherMicRecording
      ? "disabled"
      : "idle";

  const controlClass = [
    "field-control",
    value ? "is-filled" : "",
    missing ? "is-missing" : "",
    spec.type === "textarea" ? "is-textarea" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const messageId = `${fieldKey}-message`;
  const describedBy = missing ? messageId : undefined;
  const handleChange = (e) => onChange(fieldKey, e.target.value);

  return (
    <div className={`field-wrap ${spec.type === "textarea" ? "is-textarea" : ""}`}>
      <label htmlFor={fieldKey}>
        {spec.label}
        {spec.required && (
          <span className="required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className="control-shell">
        {spec.type === "textarea" && (
          <textarea
            id={fieldKey}
            ref={textareaRef}
            className={controlClass}
            value={value}
            readOnly={readOnly}
            rows={fieldKey === "medications" ? 5 : 3}
            required={spec.required}
            aria-invalid={missing || undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              handleChange(e);
              if (suggestions) trackCaret(e);
            }}
            onKeyUp={suggestions ? (e) => (e.key === "Escape" ? setCaret(null) : trackCaret(e)) : undefined}
            onClick={suggestions ? trackCaret : undefined}
            onBlur={suggestions ? () => setCaret(null) : undefined}
          />
        )}
        {(spec.type === "text" || spec.type === "date") && (
          <input
            id={fieldKey}
            type={spec.type}
            className={controlClass}
            value={value}
            readOnly={readOnly}
            required={spec.required}
            aria-invalid={missing || undefined}
            aria-describedby={describedBy}
            onChange={handleChange}
          />
        )}
        {spec.type === "city" && (
          <>
            <input
              id={fieldKey}
              type="text"
              className={controlClass}
              value={value}
              readOnly={readOnly}
              required={spec.required}
              aria-invalid={missing || undefined}
              aria-describedby={describedBy}
              onChange={handleChange}
              list={readOnly ? undefined : `${fieldKey}-suggestions`}
              autoComplete="off"
            />
            <datalist id={`${fieldKey}-suggestions`}>
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
        {spec.type === "enum" && (
          <select
            id={fieldKey}
            className={controlClass}
            value={value}
            disabled={readOnly}
            required={spec.required}
            aria-invalid={missing || undefined}
            aria-describedby={describedBy}
            onChange={handleChange}
          >
            <option value="">Choose {spec.label.toLowerCase()}</option>
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        {spec.type === "enum" && !readOnly && (
          // Our own arrow (the native one sits under the mic button).
          <ChevronDown size={16} className="select-chevron" aria-hidden="true" />
        )}
        {!readOnly && (
          <button
            type="button"
            className={`mic-button mic-${micState}`}
            onClick={handleMicClick}
            disabled={micState === "disabled" || micState === "processing"}
            aria-label={
              isRecording ? `Stop and fill in ${spec.label}` : `Dictate ${spec.label}`
            }
            title={
              micState === "disabled" && otherMicRecording && !disabled
                ? "Finish the recording in progress first"
                : micState === "disabled"
                ? "Voice input is paused for a moment"
                : isRecording
                ? "Stop and fill in this field"
                : `Dictate ${spec.label}`
            }
          >
            {micState === "processing" ? (
              <Loader2 size={16} strokeWidth={2.2} className="spin" aria-hidden="true" />
            ) : isRecording ? (
              <Square size={14} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <Mic size={16} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <TermSuggestions fieldLabel={spec.label} terms={suggested} onPick={pickTerm} />
      {missing && (
        <p className="field-message" id={messageId}>
          Please add {spec.label.toLowerCase()}.
        </p>
      )}
      {note && <p className="field-mic-note">{note}</p>}
    </div>
  );
}
