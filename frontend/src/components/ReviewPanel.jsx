import { useEffect, useRef, useState } from "react";
import { Check, X, CheckCheck, Headphones } from "lucide-react";
import { FIELD_SPECS } from "../fieldSpecs.js";

const SpeechRecognitionImpl =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

// "yes"/"no" deliberately excluded — too common in ordinary sentences
// ("no wait, let me check...") and were firing on speech that wasn't a command.
const ACCEPT_WORDS = ["accept", "except", "confirm", "correct"];
const REJECT_WORDS = ["reject", "discard", "skip", "wrong", "cancel", "remove"];

// Parses a heard phrase like "accept" or "accept diagnosis" or "discard the age"
// against the current pending list. If a field name is mentioned, targets that
// item; otherwise defaults to the first (oldest) pending item, since that's
// almost always the one being reacted to.
function parseVoiceCommand(text, pending) {
  const t = text.toLowerCase();

  // "accept" and "except" are close enough phonetically that browser speech
  // recognition mixes them up often — treat "except all" as "accept all" too.
  if (/\b(accept|except)\s+all\b/.test(t)) return { action: "acceptAll" };

  const isAccept = ACCEPT_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  const isReject = REJECT_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (!isAccept && !isReject) return { action: null };

  const matchedIndex = pending.findIndex((u) => {
    const label = (FIELD_SPECS[u.field]?.label || u.field).toLowerCase();
    return label.split(" ").some((word) => word.length > 3 && t.includes(word));
  });
  const index = matchedIndex !== -1 ? matchedIndex : 0;

  if (isAccept) return { action: "accept", index };
  return { action: "reject", index };
}

export default function ReviewPanel({ pending, unmatchedNote, onAccept, onReject, onAcceptAll }) {
  const [voiceConfirmOn, setVoiceConfirmOn] = useState(false);
  const recognitionRef = useRef(null);
  // Holds the latest props/state so the recognition's onresult handler (set up
  // once) never acts on a stale `pending` list from an earlier render.
  const latestRef = useRef({ pending, onAccept, onReject, onAcceptAll });
  latestRef.current = { pending, onAccept, onReject, onAcceptAll };

  useEffect(() => {
    if (!SpeechRecognitionImpl) return;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = false;
    // Use the browser/OS locale (e.g. en-IN) instead of hardcoding en-US —
    // matters for accent-sensitive words like "accept" vs "except".
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;
      const text = last[0].transcript.trim();
      const { pending, onAccept, onReject, onAcceptAll } = latestRef.current;
      if (!pending.length) return;
      const { action, index } = parseVoiceCommand(text, pending);
      if (action === "acceptAll") onAcceptAll();
      else if (action === "accept") onAccept(index);
      else if (action === "reject") onReject(index);
    };

    recognition.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("Hands-free confirm recognition error:", e.error);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current?.__shouldRun) {
        try {
          recognition.start();
        } catch {
          /* already running */
        }
      }
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onend = null;
      recognition.stop();
    };
  }, []);

  useEffect(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (voiceConfirmOn && pending.length > 0) {
      rec.__shouldRun = true;
      try {
        rec.start();
      } catch {
        /* already running */
      }
    } else {
      rec.__shouldRun = false;
      rec.stop();
    }
  }, [voiceConfirmOn, pending.length]);

  if (!pending.length && !unmatchedNote) return null;

  return (
    <div className="review-panel">
      <div className="review-panel-header">
        <h2 className="review-panel-title">Review what was heard</h2>
        {SpeechRecognitionImpl ? (
          <button
            type="button"
            className={`voice-confirm-toggle ${voiceConfirmOn ? "on" : ""}`}
            onClick={() => setVoiceConfirmOn((v) => !v)}
            title='Say "accept" or "discard" to confirm hands-free'
          >
            <Headphones size={14} />
            Hands-free {voiceConfirmOn ? "on" : "off"}
          </button>
        ) : null}
      </div>

      {voiceConfirmOn && (
        <p className="voice-confirm-hint">
          Say "accept" to confirm the item below, or "discard" to remove it. Say
          the field name to target a specific one for example, "accept diagnosis."
        </p>
      )}

      {pending.map((u, idx) => (
        <div className="review-item" key={`${u.field}-${idx}`}>
          <div className="field-name">{FIELD_SPECS[u.field]?.label || u.field}</div>
          {u.old_value && <div className="diff-old">{u.old_value}</div>}
          <div className="diff-new">{u.new_value}</div>
          {u.evidence && <div className="evidence">"{u.evidence}"</div>}
          <div className="review-item-actions">
            <button className="accept" onClick={() => onAccept(idx)}>
              <Check size={15} />
              Accept
            </button>
            <button onClick={() => onReject(idx)}>
              <X size={15} />
              Discard
            </button>
          </div>
        </div>
      ))}
      {pending.length > 1 && (
        <div className="review-item-actions" style={{ marginTop: 4 }}>
          <button className="accept" onClick={onAcceptAll}>
            <CheckCheck size={15} />
            Accept all
          </button>
        </div>
      )}
      {unmatchedNote && (
        <div className="unmatched-note">
          Also heard, but it didn't fit any field: {unmatchedNote}
        </div>
      )}
    </div>
  );
}