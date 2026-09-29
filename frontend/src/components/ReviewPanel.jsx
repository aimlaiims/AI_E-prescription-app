import { useEffect, useRef, useState } from "react";
import { Check, X, CheckCheck, Headphones } from "lucide-react";
import { FIELD_SPECS } from "../fieldSpecs.js";
import { parseVoiceCommands, NO_TARGET_MESSAGE } from "../voiceCommands.js";
import { HANDS_FREE_UNAVAILABLE_MESSAGE } from "../messages.js";

const SpeechRecognitionImpl =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

// Chrome (and others) periodically stop a "continuous" recognition session on
// their own — silence timeouts, internal speech-service restarts, session
// length caps. Restarting *immediately* inside onend is a known source of
// flakiness: the browser sometimes isn't ready for a new session yet and the
// start() call silently no-ops, leaving a dead window where nothing is
// listening. A short delay before restarting is a common workaround (not
// measured here).
const RESTART_DELAY_MS = 350;

// Recognition errors that will just repeat on every automatic restart —
// without this, the toggle looks "on" while silently retrying every 350ms.
const FATAL_RECOGNITION_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
  "network",
]);

// `paused`: a dictation mic is open, so stop listening for commands —
// otherwise dictated words like "confirm diagnosis" or "remove sutures" would
// be taken as accept/discard.
export default function ReviewPanel({
  pending,
  unmatchedNote,
  onAccept,
  onReject,
  onAcceptAll,
  paused,
}) {
  const [voiceConfirmOn, setVoiceConfirmOn] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // Shown when a command named something that matched no pending item —
  // nothing was accepted or discarded, and the doctor needs to know that.
  const [voiceNotice, setVoiceNotice] = useState("");
  const [handsFreeError, setHandsFreeError] = useState("");
  const recognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);
  // Holds the latest props/state so the recognition's onresult handler (set up
  // once) never acts on a stale `pending` list from an earlier render.
  const latestRef = useRef({ pending, onAccept, onReject, onAcceptAll, paused });
  latestRef.current = { pending, onAccept, onReject, onAcceptAll, paused };

  useEffect(() => {
    if (!SpeechRecognitionImpl) return;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = false;
    // Use the browser/OS locale (e.g. en-IN) instead of hardcoding en-US —
    // matters for accent-sensitive words like "accept" vs "except".
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      // Read every result that is new in this event (from resultIndex), not
      // just the last one — one event can carry several final results, and
      // parsing them as one utterance lets the parser keep its claimed-item
      // bookkeeping across all of them.
      const finals = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finals.push(event.results[i][0].transcript);
      }
      if (!finals.length) return;
      const { pending, onAccept, onReject, onAcceptAll, paused } = latestRef.current;
      // A result can still arrive just after a dictation mic opened.
      if (!pending.length || paused) return;

      const { commands, unmatched } = parseVoiceCommands(finals.join(" "), pending);
      setVoiceNotice(unmatched ? NO_TARGET_MESSAGE : "");
      for (const cmd of commands) {
        if (cmd.action === "acceptAll") onAcceptAll();
        else if (cmd.action === "accept") onAccept(cmd.id);
        else if (cmd.action === "reject") onReject(cmd.id);
      }
    };

    recognition.onstart = () => setIsListening(true);

    recognition.onerror = (e) => {
      if (FATAL_RECOGNITION_ERRORS.has(e.error)) {
        recognition.__shouldRun = false;
        setVoiceConfirmOn(false);
        setHandsFreeError(HANDS_FREE_UNAVAILABLE_MESSAGE);
      }
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("Hands-free confirm recognition error:", e.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (recognitionRef.current?.__shouldRun) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = setTimeout(() => {
          if (!recognitionRef.current?.__shouldRun) return;
          try {
            recognition.start();
          } catch {
            /* already running, or the browser wasn't ready yet — onend will fire again */
          }
        }, RESTART_DELAY_MS);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      clearTimeout(restartTimeoutRef.current);
      recognition.onend = null;
      recognition.stop();
    };
  }, []);

  useEffect(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (voiceConfirmOn && pending.length > 0 && !paused) {
      rec.__shouldRun = true;
      try {
        rec.start();
      } catch {
        /* already running */
      }
    } else {
      rec.__shouldRun = false;
      clearTimeout(restartTimeoutRef.current);
      rec.stop();
      if (!paused) setVoiceNotice("");
    }
  }, [voiceConfirmOn, pending.length, paused]);

  if (!pending.length && !unmatchedNote) return null;

  const dotTitle = paused
    ? "Paused while you dictate"
    : isListening
    ? "Listening"
    : "Reconnecting the mic. This is normal and takes under a second.";

  return (
    <section className="review-panel" aria-labelledby="review-panel-title">
      <div className="review-header">
        <h2 id="review-panel-title">Review what was heard</h2>
        {SpeechRecognitionImpl ? (
          <button
            type="button"
            className="hands-free-toggle"
            aria-pressed={voiceConfirmOn}
            onClick={() => {
              setHandsFreeError("");
              setVoiceConfirmOn((v) => !v);
            }}
            title='Say "accept" or "discard" to confirm hands-free'
          >
            <Headphones size={15} aria-hidden="true" />
            <span>Hands-free {voiceConfirmOn ? "on" : "off"}</span>
            {voiceConfirmOn && (
              <span
                className={`listening-dot ${isListening && !paused ? "is-listening" : ""}`}
                role="img"
                aria-label={dotTitle}
                title={dotTitle}
              />
            )}
          </button>
        ) : null}
      </div>

      {voiceConfirmOn && (
        <p className="hands-free-hint">
          Say "accept" or "discard" for the item marked Next. Add the field name
          to pick a different one, for example "accept diagnosis." You can chain
          several commands in one breath, like "accept diagnosis, accept
          medications." A dim dot next to the toggle means it's briefly
          reconnecting. This is normal and resolves on its own.
        </p>
      )}

      {voiceConfirmOn && paused && (
        <p className="voice-notice" role="status">
          Hands-free is paused while you dictate. It resumes when you stop.
        </p>
      )}

      {handsFreeError && (
        <p className="voice-notice" role="alert">
          {handsFreeError}
        </p>
      )}

      {voiceConfirmOn && !paused && voiceNotice && (
        <p className="voice-notice" role="status">
          {voiceNotice}
        </p>
      )}

      {pending.length > 0 && (
        <div className="review-items">
          {pending.map((u, idx) => {
            const label = FIELD_SPECS[u.field]?.label || u.field;
            const isNext = voiceConfirmOn && idx === 0;
            return (
              <article
                key={u.id}
                className={`review-item ${isNext ? "is-next" : ""}`}
                role="group"
                aria-label={`${label}: proposed change`}
              >
                <div className="review-item-heading">
                  <span className="review-field-label">{label}</span>
                  {u.supersedes && (
                    <span className="updated-tag" title="Replaces an earlier proposal for this field">
                      Updated
                    </span>
                  )}
                  {isNext && <span className="next-tag">Next</span>}
                </div>
                {u.old_value && (
                  <p className="review-old">
                    <span className="sr-only">Currently: </span>
                    {u.old_value}
                  </p>
                )}
                <p className={`review-new ${u.field === "medications" ? "is-monospace" : ""}`}>
                  <span className="sr-only">Proposed: </span>
                  {u.new_value}
                </p>
                {u.evidence && <p className="review-heard">"{u.evidence}"</p>}
                <div className="review-item-actions">
                  <button type="button" className="review-accept" onClick={() => onAccept(u.id)}>
                    <Check size={16} aria-hidden="true" />
                    Accept
                  </button>
                  <button type="button" className="review-discard" onClick={() => onReject(u.id)}>
                    <X size={16} aria-hidden="true" />
                    Discard
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {pending.length > 1 && (
        <button type="button" className="accept-all" onClick={onAcceptAll}>
          <CheckCheck size={16} aria-hidden="true" />
          Accept all
        </button>
      )}
      {unmatchedNote && (
        <p className="also-heard">
          <strong>Also heard, but it didn't fit any field:</strong> {unmatchedNote}
        </p>
      )}
    </section>
  );
}
