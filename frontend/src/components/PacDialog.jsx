import { useState } from "react";
import { Shell } from "./PatientDialogs.jsx";
import { PAC_OPTIONS, pacChoice, pacLine, withPacLine } from "../pac.js";

// "PAC" under Investigation: the type of anaesthesia, then its tests as ticks.
// "Add to Investigation" writes one line there (or replaces the earlier PAC
// line) — the doctor's own choice, like typing, so it needs no review.
export default function PacDialog({ investigation, onApply, onClose }) {
  const [choice, setChoice] = useState(() => pacChoice(investigation));
  const { option, ticked } = choice;

  const toggle = (name) =>
    setChoice((c) => {
      const next = new Set(c.ticked);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...c, ticked: next };
    });

  const line = option ? pacLine(option, ticked) : "";
  const apply = () => {
    onApply(withPacLine(investigation, line));
    onClose();
  };

  return (
    <Shell
      titleId="pac-title"
      title="PAC investigations"
      subtitle="Pre-anaesthetic check-up: choose the anaesthesia, then the tests."
      onClose={onClose}
      closeLabel="Close without adding"
      className="pac-dialog"
    >
      <fieldset className="pac-types">
        <legend>Anaesthesia</legend>
        {PAC_OPTIONS.map((o) => (
          <label key={o.id} className={`pac-type ${option === o ? "is-chosen" : ""}`}>
            <input
              type="radio"
              name="pac-type"
              checked={option === o}
              onChange={() => setChoice(pacChoice(investigation, o))}
            />
            {o.label}
          </label>
        ))}
      </fieldset>

      {option && (
        <fieldset className="pac-tests">
          <legend>Tests</legend>
          {option.tests.map((t) => (
            <label key={t.name} className="pac-test">
              <input type="checkbox" checked={ticked.has(t.name)} onChange={() => toggle(t.name)} />
              <span>
                {t.name}
                {t.when && <span className="pac-when"> ({t.when})</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="patient-dialog-actions">
        <button type="button" className="records-button primary" onClick={apply} disabled={!line}>
          Add to Investigation
        </button>
        <button type="button" className="records-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}
