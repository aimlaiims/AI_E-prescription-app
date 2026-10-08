// Suggestion chips under a multi-line field: tap one to complete the line
// being typed (suggest.js). Tapping is the doctor's own input, like typing.
// The field keeps focus (pointerdown is prevented), so the tablet keyboard
// stays open.
export default function TermSuggestions({ fieldLabel, terms, onPick }) {
  if (!terms.length) return null;
  return (
    <div className="term-suggestions" role="group" aria-label={`Suggestions for ${fieldLabel}`}>
      {terms.map((t) => (
        <button
          key={t.name}
          type="button"
          className="term-chip"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(t)}
          title={t.group || undefined}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
