// Hands-free confirm: turns a recognized phrase ("accept diagnosis, discard
// age") into accept/reject actions against the pending review items.
// Pure functions, no React, so the rules can be tested directly
// (voiceCommands.test.js).
import { FIELD_SPECS } from "./fieldSpecs.js";

// "yes"/"no" deliberately excluded — too common in ordinary sentences
// ("no wait, let me check...") and were firing on speech that wasn't a command.
// "except" is a frequent mis-hearing of "accept".
export const ACCEPT_WORDS = ["accept", "except", "confirm", "correct"];
export const REJECT_WORDS = ["reject", "discard", "skip", "wrong", "cancel", "remove"];
const ACCEPT_SET = new Set(ACCEPT_WORDS);
const REJECT_SET = new Set(REJECT_WORDS);
const isCommandWord = (w) => ACCEPT_SET.has(w) || REJECT_SET.has(w);

// Words that can sit between a command and its target without meaning
// anything: "accept the diagnosis please". A command followed by ONLY these
// is treated as a bare command.
const FILLER = new Set([
  "the", "this", "that", "it", "one", "please", "now", "and", "then", "ok", "okay",
]);

// What a doctor might say to name each field. Matched as whole words (so
// "age" never matches inside "image"), and multi-word aliases as a sequence.
// Keyed by FIELD_SPECS key; a field missing here falls back to its label words.
export const FIELD_ALIASES = {
  patient_name: ["patient name", "name", "patient"],
  date: ["date"],
  age: ["age"],
  gender: ["gender", "sex"],
  chief_complaints: ["chief complaints", "chief complaint", "complaints", "complaint", "chief", "c o"],
  on_examination: ["on examination", "examination", "exam", "o e", "oe", "findings"],
  diagnosis: ["diagnosis", "dx", "impression"],
  investigation: ["investigation", "investigations", "tests", "test", "labs", "lab", "ix"],
  medications: ["medications", "medication", "medicines", "medicine", "rx", "drugs"],
};

export const NO_TARGET_MESSAGE =
  "Didn't catch which item. Say the field name, or tap Accept or Discard.";

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function aliasesFor(field) {
  const aliases = FIELD_ALIASES[field] || [(FIELD_SPECS[field]?.label || field).toLowerCase()];
  return aliases.map(tokenize);
}

function containsSequence(tokens, seq) {
  for (let i = 0; i + seq.length <= tokens.length; i++) {
    if (seq.every((w, j) => tokens[i + j] === w)) return true;
  }
  return false;
}

// Which field (if any) the words after a command name. Longer aliases are
// tried first so "patient name" wins over "patient".
function namedField(words) {
  let best = null;
  for (const field of Object.keys(FIELD_SPECS)) {
    for (const seq of aliasesFor(field)) {
      if (containsSequence(words, seq) && (!best || seq.length > best.len)) {
        best = { field, len: seq.length };
      }
    }
  }
  return best?.field ?? null;
}

/**
 * Parse every command in one recognized utterance.
 *
 * Browser recognition often merges several commands said without a pause
 * into one result ("accept diagnosis accept medications accept all"), so
 * every command word is handled, in order. Targets are claimed from a
 * shrinking working copy so two commands in one breath never hit the same
 * item. Dispatch is by stable id, never array index.
 *
 * Rules:
 *  - "accept all" / "except all" -> acceptAll.
 *  - Bare command ("accept", "discard the one") -> the top (oldest) item.
 *  - Command + a field name -> the first pending item for that field.
 *  - Command + other words that name no pending field -> NOTHING happens and
 *    `unmatched` is set. Silently acting on the top item instead is how the
 *    wrong medical field used to get accepted.
 *
 * @returns {{ commands: Array<{action: "accept"|"reject"|"acceptAll", id?: string}>, unmatched: boolean }}
 */
export function parseVoiceCommands(text, pending) {
  const words = tokenize(text);
  const commands = [];
  let unmatched = false;
  let working = [...pending];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if ((word === "accept" || word === "except") && words[i + 1] === "all") {
      if (working.length) commands.push({ action: "acceptAll" });
      working = [];
      i += 1;
      continue;
    }
    if (!isCommandWord(word)) continue;

    // Words after this command, up to the next command word (max 4), so one
    // command never reads the next command's target.
    const following = [];
    for (let j = i + 1; j < Math.min(i + 5, words.length); j++) {
      if (isCommandWord(words[j])) break;
      following.push(words[j]);
    }
    const meaningful = following.filter((w) => !FILLER.has(w));

    let target = null;
    if (meaningful.length === 0) {
      target = working[0] ?? null;
    } else {
      const field = namedField(meaningful);
      target = field ? working.find((u) => u.field === field) ?? null : null;
      if (!target) unmatched = true;
    }

    if (target) {
      commands.push({ action: ACCEPT_SET.has(word) ? "accept" : "reject", id: target.id });
      working = working.filter((u) => u.id !== target.id);
    }
  }

  return { commands, unmatched };
}
