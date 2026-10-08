// Typing suggestions for multi-line fields (Diagnosis, Medications), from the
// department's terms (GET /api/vocabulary). Pure functions, tested in
// suggest.test.js; the chips are in components/TermSuggestions.jsx.

// A medicine line may start with its form; suggestions match what follows.
const FORM_PREFIX = /^(?:(?:tab|tabs|cap|syp|syr|inj|gtt|oint|susp|drops?)\.?\s+)/i;
const MIN_CHARS = 2;

const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// The line the caret is on: { start, end, prefix, fragment }. `prefix` is a
// leading form ("Tab. ") kept as typed; `fragment` is what to match.
export function currentLine(value, caret = value.length) {
  const start = value.lastIndexOf("\n", caret - 1) + 1;
  const nl = value.indexOf("\n", caret);
  const end = nl === -1 ? value.length : nl;
  const text = value.slice(start, end);
  const m = FORM_PREFIX.exec(text);
  const prefix = m ? m[0] : "";
  return { start, end, prefix, fragment: text.slice(prefix.length) };
}

// Up to `limit` terms for what is typed, best first: the name starts with it,
// then an abbreviation does, then a later word of the name does. Nothing for
// fewer than 2 letters, or when the line already is exactly a term.
export function matchTerms(terms, fragment, limit = 6) {
  const q = fold(fragment).trim();
  if (q.length < MIN_CHARS || !terms?.length) return [];
  const scored = [];
  for (const t of terms) {
    const name = fold(t.name);
    if (name === q) return [];
    const aliases = (t.aliases || []).map(fold);
    let score = null;
    if (name.startsWith(q)) score = 0;
    else if (aliases.some((a) => a.startsWith(q))) score = 1;
    else if (name.split(/[\s\-–(/]+/).some((w) => w && w.startsWith(q))) score = 2;
    if (score !== null) scored.push({ t, score });
  }
  scored.sort((a, b) => a.score - b.score || a.t.name.length - b.t.name.length || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, limit).map((s) => s.t);
}

// The field's new value and caret after choosing `term` for the caret's line:
// the line becomes prefix + name (+ a space for medicines, to go on with the
// strength). Other lines are untouched.
export function applyTerm(value, caret, term, { trailingSpace = false } = {}) {
  const { start, end, prefix } = currentLine(value, caret);
  const line = prefix + term.name + (trailingSpace ? " " : "");
  return { value: value.slice(0, start) + line + value.slice(end), caret: start + line.length };
}
