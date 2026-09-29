import { useState } from "react";
import { AlertTriangle, Check, Clock3, Copy, RotateCcw } from "lucide-react";
import { friendlyCooldownReason } from "../messages.js";

// One banner, three kinds. Presentational: App owns every value shown here
// (including the cooldown countdown, so there is only ever one clock).
//   saved    — Reference ID (tap to copy), "now final" note, new prescription
//   error    — `message`, already plain language (see messages.js)
//   cooldown — `secondsLeft` until voice input works again
export default function StatusBanner({ kind, message, referenceId, secondsLeft, onNewPrescription }) {
  const [copied, setCopied] = useState(false);

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(referenceId);
    } catch {
      // Clipboard API blocked (e.g. insecure origin): legacy fallback.
      const input = document.createElement("textarea");
      input.value = referenceId;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (kind === "cooldown") {
    return (
      <div className="status-banner status-cooldown" role="status">
        <Clock3 size={18} className="status-icon" aria-hidden="true" />
        <div className="status-copy">
          <strong>Voice input is taking a short break</strong>
          <span>{friendlyCooldownReason()}</span>
        </div>
        <div className="cooldown-count" role="timer" aria-label={`${secondsLeft} seconds remaining`}>
          {secondsLeft}s
        </div>
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="status-banner status-error" role="alert">
        <AlertTriangle size={18} className="status-icon" aria-hidden="true" />
        <div className="status-copy">
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="status-banner status-success" role="status">
      <Check size={18} strokeWidth={2.5} className="status-icon" aria-hidden="true" />
      <div className="status-copy">
        <span>
          Prescription saved. Reference ID{" "}
          <button
            type="button"
            className="reference-button"
            onClick={copyReference}
            aria-label={`Copy Reference ID ${referenceId}`}
          >
            {referenceId}
            <Copy size={13} aria-hidden="true" />
          </button>
          {copied && (
            <span className="copied-tip" role="status">
              Copied
            </span>
          )}
        </span>
        <span className="status-note">
          This prescription is now final. To make a change, start a new prescription.
        </span>
      </div>
      <button type="button" className="status-secondary" onClick={onNewPrescription}>
        <RotateCcw size={15} aria-hidden="true" />
        Start a new prescription
      </button>
    </div>
  );
}
