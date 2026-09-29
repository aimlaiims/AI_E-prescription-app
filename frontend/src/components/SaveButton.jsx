import { Check, Loader2, Save } from "lucide-react";

// Save lifecycle under lock-after-save (ROADMAP P0-1): once saved the
// prescription is final, so there is no "Update record" phase.
//   unsaved -> "Save prescription"   saving -> "Saving…"   saved -> "Saved" (disabled)
export default function SaveButton({ phase, onSave, disabled }) {
  const busy = phase === "saving";
  const Icon = busy ? Loader2 : phase === "saved" ? Check : Save;
  const label = busy ? "Saving…" : phase === "saved" ? "Saved" : "Save prescription";
  return (
    <button
      type="button"
      className={`action-button ${phase === "saved" ? "secondary" : "primary"}`}
      onClick={onSave}
      disabled={disabled || busy || phase === "saved"}
    >
      <Icon size={17} className={busy ? "spin" : undefined} aria-hidden="true" />
      {label}
    </button>
  );
}
