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
const ACCEPT_SET = new Set(ACCEPT_WORDS);
const REJECT_SET = new Set(REJECT_WORDS);

// Browser speech recognition can merge several spoken commands into ONE
// final result when there's no pause between them — saying "accept diagnosis,
// accept medications, accept all" without breaks often arrives as a single
// recognized string, not three separate results. Extracting only the first
// command (the old behavior) silently drops the rest, which is exactly what
// causes "I had to repeat myself" when actually every earlier command DID
// get heard, just never acted on. This scans for every command keyword in
// the utterance and returns them all, in order.
//
// Field-matching for each command is done against a "working" copy that
// shrinks as each command in the SAME utterance is simulated — so if you say
// "accept diagnosis accept medications", the second command doesn't
// accidentally re-target the item the first command already claimed.
// Dispatch uses stable ids (not array position), since firing several
// accept/reject actions in one synchronous batch is exactly the situation
// where index-based targeting would shift under itself.
function parseVoiceCommands(text, pendingSnapshot) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const commands = [];
  let working = [...pendingSnapshot];

  let i = 0;
  while (i < words.length) {
    const word = words[i];

    if ((word === "accept" || word === "except") && words[i + 1] === "all") {
      commands.push({ action: "acceptAll" });
      working = [];
      i += 2;
      continue;
    }

    const isAccept = ACCEPT_SET.has(word);
    const isReject = REJECT_SET.has(word);
    if (isAccept || isReject) {
      // Look ahead a few words for a field-name mention, stopping at the
      // next command keyword so we don't bleed into a following command.
      const lookahead = [];
      for (let j = i + 1; j < Math.min(i + 5, words.length); j++) {
        if (ACCEPT_SET.has(words[j]) || REJECT_SET.has(words[j])) break;
        lookahead.push(words[j]);
      }
      const phrase = lookahead.join(" ");
      const matchIdx = working.findIndex((u) => {
        const label = (FIELD_SPECS[u.field]?.label || u.field).toLowerCase();
        return label.split(" ").some((w) => w.length > 3 && phrase.includes(w));
      });
      const target = working[matchIdx !== -1 ? matchIdx : 0];
      if (target) {
        commands.push({ action: isAccept ? "accept" : "reject", id: target.id });
        working = working.filter((u) => u.id !== target.id);
      }
    }
    i += 1;
  }

  return commands;
}

// Chrome (and others) periodically stop a "continuous" recognition session on
// their own — silence timeouts, internal speech-service restarts, session
// length caps. Restarting *immediately* inside onend is a known source of
// flakiness: the browser sometimes isn't ready for a new session yet and the
// start() call silently no-ops, leaving a dead window where nothing is
// listening. A short delay before restarting is measurably more reliable.
const RESTART_DELAY_MS = 350;

export default function ReviewPanel({ pending, unmatchedNote, onAccept, onReject, onAcceptAll }) {
  const [voiceConfirmOn, setVoiceConfirmOn] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);
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

      const commands = parseVoiceCommands(text, pending);
      for (const cmd of commands) {
        if (cmd.action === "acceptAll") onAcceptAll();
        else if (cmd.action === "accept") onAccept(cmd.id);
        else if (cmd.action === "reject") onReject(cmd.id);
      }
    };

    recognition.onstart = () => setIsListening(true);

    recognition.onerror = (e) => {
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
    if (voiceConfirmOn && pending.length > 0) {
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
            {voiceConfirmOn && (
              <span
                className={`listening-dot ${isListening ? "active" : ""}`}
                title={isListening ? "Listening" : "Reconnecting the mic. This is normal and takes under a second."}
              />
            )}
          </button>
        ) : null}
      </div>

      {voiceConfirmOn && (
        <p className="voice-confirm-hint">
          Say "accept" to confirm an item, or "discard" to remove it. Say the
          field name to target a specific one, for example "accept diagnosis." You
          can chain several commands in one breath, like "accept diagnosis, accept
          medications." A dim dot next to the toggle means it's briefly
          reconnecting. This is normal and resolves on its own.
        </p>
      )}

      {pending.map((u) => (
        <div className="review-item" key={u.id}>
          <div className="field-name">{FIELD_SPECS[u.field]?.label || u.field}</div>
          {u.old_value && <div className="diff-old">{u.old_value}</div>}
          <div className="diff-new">{u.new_value}</div>
          {u.evidence && <div className="evidence">"{u.evidence}"</div>}
          <div className="review-item-actions">
            <button className="accept" onClick={() => onAccept(u.id)}>
              <Check size={15} />
              Accept
            </button>
            <button onClick={() => onReject(u.id)}>
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
