#!/usr/bin/env node
/**
 * Verifies that the changes listed in docs/CHANGELOG.md are actually present
 * in the working tree, and reports which known issues (docs/ROADMAP.md) are
 * still open. Static checks only — it greps source files. It cannot prove
 * runtime behavior (live Gemini/Groq calls, browser speech, layout); for that
 * see docs/TESTING.md.
 *
 * Usage (from repo root, any OS):   node scripts/verify-changes.mjs
 * Exit code: 0 if every "expected change" check passes, 1 otherwise.
 * Known-issue lines never affect the exit code.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : null);
const matches = (text, needle) =>
  text !== null && (needle instanceof RegExp ? needle.test(text) : text.includes(needle));

let failed = 0;
let passed = 0;

function expect(label, file, needle, { present = true } = {}) {
  const text = read(file);
  let ok;
  if (text === null) ok = false;
  else ok = matches(text, needle) === present;
  const detail = text === null ? `${file} is MISSING` : `${file} ${present ? "should contain" : "should NOT contain"} ${needle}`;
  if (ok) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.log(`  ✘ ${label}\n      ${detail}`); }
}

console.log("\nBackend");
expect("UpstreamError taxonomy exists (errors.py, plural)", "backend/app/errors.py", "class UpstreamError");
expect("voice router translates UpstreamError to structured JSON", "backend/app/routers/voice.py", "_upstream_to_http");
expect("Groq errors are classified (rate limit)", "backend/app/services/transcription.py", "groq_sdk.RateLimitError");
expect("Groq call is timed", "backend/app/services/transcription.py", "[timing] Groq transcription");
expect("Gemini 429 handled separately from 5xx", "backend/app/services/extraction.py", "genai_errors.ClientError");
expect("Gemini 5xx retried with backoff", "backend/app/services/extraction.py", "_generate_with_retry");
expect("Gemini call is timed", "backend/app/services/extraction.py", "[timing] Gemini extraction");
expect("Gemini output capped (max_output_tokens)", "backend/app/services/extraction.py", "max_output_tokens");
expect("Gemini finish_reason checked; bad output raises, not 'no updates'", "backend/app/services/extraction.py", "_finish_reason(response)");
expect("Spoken-synonym hint in prompt (sex->gender etc.)", "backend/app/services/extraction.py", "synonym_hint");
expect("Append / correct / replace rule in prompt", "backend/app/services/extraction.py", "CORRECTION language");
expect("Config default model is flash-lite", "backend/app/config.py", 'gemini-3.5-flash-lite');
expect("Config reads GEMINI_API_KEY", "backend/app/config.py", "GEMINI_API_KEY");
expect("Save validation returns structured error_code", "backend/app/routers/forms.py", '"error_code": "validation"');
expect("Save validation uses friendly field labels", "backend/app/routers/forms.py", "FORM_FIELD_SPECS[f][\"label\"]");
expect(".env.example has GEMINI_API_KEY", "backend/.env.example", "GEMINI_API_KEY");
expect(".env.example has no leftover ANTHROPIC key", "backend/.env.example", /ANTHROPIC/i, { present: false });
expect("requirements include google-genai", "backend/requirements.txt", "google-genai");
expect("requirements have no leftover anthropic", "backend/requirements.txt", /^anthropic/m, { present: false });

console.log("\nFrontend — logic");
expect("ApiError class parses structured errors", "frontend/src/api.js", "class ApiError");
expect("messages.js exports friendlyErrorMessage", "frontend/src/messages.js", "export function friendlyErrorMessage");
expect("messages.js exports friendlyCooldownReason", "frontend/src/messages.js", "export function friendlyCooldownReason");
expect("App: stable ids for pending updates", "frontend/src/App.jsx", "nextPendingId");
expect("App: accept is id-based, not index-based", "frontend/src/App.jsx", "pending.find((u) => u.id === id)");
expect("App: save/print errors routed via handleSaveError", "frontend/src/App.jsx", "handleSaveError");
expect("App: Print saves first, opens preview window before any await", "frontend/src/App.jsx", "const previewWindow = window.open");
expect("App: View old records placeholder present", "frontend/src/App.jsx", "handleViewOldRecords");
expect("App: form locks after save (P0-1)", "frontend/src/App.jsx", "readOnly: locked");
expect("App: save blocked while items await review", "frontend/src/App.jsx", "blockIfPending");
expect("App: stale results from a previous form are dropped (formGen)", "frontend/src/App.jsx", "formGen !== formGenRef.current");
expect("App: default date is local, not UTC", "frontend/src/App.jsx", "d.getFullYear()");
expect("ReviewPanel: hands-free pauses while a mic records", "frontend/src/components/ReviewPanel.jsx", "!paused");
expect("ReviewPanel: fatal recognition errors stop the retry loop", "frontend/src/components/ReviewPanel.jsx", "FATAL_RECOGNITION_ERRORS");
expect("DictateBar: Space ignored on a focused button (P0-2d)", "frontend/src/components/DictateBar.jsx", "isActivatable");
expect("api: upload name matches recorded format (Safari mp4)", "frontend/src/api.js", "export function audioFileName");
expect("useRecorder: double start guarded", "frontend/src/useRecorder.js", "startingRef");
expect("schemas: target_field validated", "backend/app/schemas.py", "_known_field");
expect("local Whisper decodes from memory (Windows temp-file bug)", "backend/app/services/transcription.py", "io.BytesIO(audio_bytes),");
expect("Print template escapes user text", "frontend/src/printTemplate.js", "function escapeHtml");
expect("Print template exports buildPrintHtml", "frontend/src/printTemplate.js", "export function buildPrintHtml");
expect("DictateBar: transcript-preserving retry", "frontend/src/components/DictateBar.jsx", "lastTranscript");
expect("DictateBar: spacebar shortcut, ignores repeats", "frontend/src/components/DictateBar.jsx", /e\.code !== "Space"[\s\S]*e\.repeat/);
expect("DictateBar: spacebar ignores typing targets", "frontend/src/components/DictateBar.jsx", "isTypingTarget");
expect("FormField: failures routed to onVoiceError", "frontend/src/components/FormField.jsx", "onVoiceError(err)");
expect("voiceCommands.js: multi-command parser (plural)", "frontend/src/voiceCommands.js", "export function parseVoiceCommands");
expect("voiceCommands.js: per-field aliases, whole-word matching", "frontend/src/voiceCommands.js", "FIELD_ALIASES");
expect("voiceCommands.js: unmatched target does nothing and says so", "frontend/src/voiceCommands.js", "NO_TARGET_MESSAGE");
expect("voiceCommands.test.js exists (npm test)", "frontend/src/voiceCommands.test.js", "parseVoiceCommands");
expect("pendingUpdates.js: one pending item per field (P0-4)", "frontend/src/pendingUpdates.js", "export function mergePending");
expect("App: extraction sees pending proposals applied", "frontend/src/App.jsx", "withPendingApplied(state, pending)");
expect("ReviewPanel: reads every new result (event.resultIndex)", "frontend/src/components/ReviewPanel.jsx", "event.resultIndex");
expect("ReviewPanel: old single-command parser removed", "frontend/src/components/ReviewPanel.jsx", /parseVoiceCommand\(/, { present: false });
expect("voiceCommands: 'accept'/'except' both treated as accept", "frontend/src/voiceCommands.js", /ACCEPT_WORDS = \[[^\]]*"except"/);
expect("voiceCommands: 'yes'/'no' NOT command words", "frontend/src/voiceCommands.js", /(ACCEPT|REJECT)_WORDS = \[[^\]]*"(yes|no)"/, { present: false });
expect("ReviewPanel: locale from navigator.language", "frontend/src/components/ReviewPanel.jsx", "navigator.language");
expect("ReviewPanel: delayed recognizer restart", "frontend/src/components/ReviewPanel.jsx", "RESTART_DELAY_MS");
expect("ReviewPanel: buttons pass ids, not indexes", "frontend/src/components/ReviewPanel.jsx", "onAccept(u.id)");
expect("ReviewPanel: no debug 'Heard:' readout shown to user", "frontend/src/components/ReviewPanel.jsx", "lastHeard", { present: false });

console.log("\nFrontend — styles, config, deps");
for (const cls of [".dictate-button", ".retry-button", ".listening-dot", ".status-banner", ".toolbar", ".prescription-sheet", ".form-footer", ".field-control", ".mic-button"]) {
  expect(`styles.css defines ${cls}`, "frontend/src/styles.css", cls);
}
expect("mobile sticky footer rule present", "frontend/src/styles.css", /@media \(max-width: 639px\)[\s\S]*position: fixed/);
expect("vite: dev allowedHosts covers ngrok-free.dev", "frontend/vite.config.js", ".ngrok-free.dev");
expect("vite: separate preview block (own proxy + hosts)", "frontend/vite.config.js", /preview:\s*\{[\s\S]*allowedHosts[\s\S]*proxy/);
expect("package.json has lucide-react", "frontend/package.json", "lucide-react");
expect("UI: StatusBanner component", "frontend/src/components/StatusBanner.jsx", "export default function StatusBanner");
expect("UI: SaveButton component (no Update phase: lock-after-save)", "frontend/src/components/SaveButton.jsx", "export default function SaveButton");
expect("UI: input borders use --control-line", "frontend/src/styles.css", "border: 1px solid var(--control-line)");
expect("UI: reduced motion actually stops animations", "frontend/src/styles.css", "animation: none !important");
expect("UI: no <form> submit (Enter must not save)", "frontend/src/App.jsx", /<form[\s>]/, { present: false });
expect("Print: signature kept with the last medication lines", "frontend/src/printTemplate.js", ".closing { break-inside: avoid;");
expect("Print: fixed month names (no 'Sept')", "frontend/src/printTemplate.js", "const MONTHS = [");

console.log(`\n${passed} passed, ${failed} failed\n`);

/* ------------------------------------------------------------------ */
// Three states, on purpose. "Bug pattern not found" is NOT evidence of a fix — the code
// may simply be shaped differently than the pattern expects (an earlier version of this
// script reported three unfixed bugs as fixed for exactly that reason: the old parser
// named its loop variable `word`, not `w`). So:
//   fixed   = positive evidence of the fix was found
//   OPEN    = the buggy pattern was found and no fix evidence
//   unknown = neither found — check by hand
console.log("Known issues (informational — see docs/ROADMAP.md)");
const tally = { OPEN: 0, fixed: 0, unknown: 0 };
function known(label, { open = false, fixed = false }) {
  const state = fixed ? "fixed" : open ? "OPEN" : "unknown";
  tally[state]++;
  const icon = { OPEN: "⚠ OPEN   ", fixed: "✔ fixed  ", unknown: "? unknown " }[state];
  console.log(`  ${icon} ${label}`);
}
const src = (p) => read(p) || "";
const any = (files, re) => files.some((f) => re.test(src(f)));
const PARSER = ["frontend/src/components/ReviewPanel.jsx", "frontend/src/voiceCommands.js"];
const hasDir = (p) => existsSync(resolve(root, p));

// P0-1 has two accepted fixes: an update endpoint, or locking the form after
// save (the one chosen). Either is positive evidence.
known("P0-1   Editing after Save (Print can diverge from stored record)", {
  open: !/@router\.(put|patch)/.test(src("backend/app/routers/forms.py")) && !/readOnly: locked/.test(src("frontend/src/App.jsx")),
  fixed: /@router\.(put|patch)/.test(src("backend/app/routers/forms.py")) || /readOnly: locked/.test(src("frontend/src/App.jsx")),
});
known("P0-2a  Voice: short field names (e.g. 'age') can never be targeted", {
  open: any(PARSER, /\.length\s*>\s*3/),
  fixed: hasDir("frontend/src") && existsSync(resolve(root, "frontend/src/voiceCommands.js")) && /alias/i.test(src("frontend/src/voiceCommands.js")),
});
known("P0-2c  Voice: unmatched field name silently falls back to the TOP item", {
  open: any(PARSER, /!==\s*-1\s*\?\s*\w+\s*:\s*0/),
  fixed: any(PARSER, /Didn't catch which item/),
});
known("P0-2e  Voice: only the LAST result of a recognition event is read", {
  open: any(PARSER, /event\.results\[\s*event\.results\.length\s*-\s*1\s*\]/),
  fixed: any(PARSER, /event\.resultIndex/),
});
known("P0-3   Extraction: bad/truncated model output is returned as 'no updates'", {
  open: /except\s*\(\s*ValueError\s*,\s*TypeError\s*\)/.test(src("backend/app/services/extraction.py")),
  fixed: /finish_reason/.test(src("backend/app/services/extraction.py")),
});
known("P0-4   Same field can be pending twice (second computed against a stale base)", {
  open: /setPending\(\s*\(?\s*prev\s*\)?\s*=>\s*\[\s*\.\.\.prev\s*,\s*\.\.\./.test(src("frontend/src/App.jsx")),
  fixed: /supersed|dedupe/i.test(src("frontend/src/App.jsx")),
});
known("P1-1   Sync SDK calls + time.sleep inside async routes", {
  open: /async def (transcribe|extract)/.test(src("backend/app/routers/voice.py")) && /time\.sleep/.test(src("backend/app/services/extraction.py")),
  fixed: /run_in_threadpool|to_thread/.test(src("backend/app/routers/voice.py")),
});
const envModel = src("backend/.env.example").match(/^EXTRACTION_MODEL=(.+)$/m)?.[1]?.trim();
const cfgModel = src("backend/app/config.py").match(/"EXTRACTION_MODEL",\s*"([^"]+)"/)?.[1];
known("hygiene  .env.example and config.py agree on the default model", {
  open: !!envModel && !!cfgModel && envModel !== cfgModel,
  fixed: !!envModel && !!cfgModel && envModel === cfgModel,
});
known("hygiene  requirements.txt no longer pins pydantic 2.9.2 (needs >=2.12 on Python 3.14)", {
  open: /pydantic==2\.9\.2/.test(src("backend/requirements.txt")),
  fixed: /pydantic\s*(>=|~=)\s*2\.(1[2-9]|[2-9]\d)/.test(src("backend/requirements.txt")),
});
known("hygiene  README describes Gemini, not Claude/Anthropic", {
  open: /anthropic/i.test(src("README.md")),
  fixed: src("README.md") !== "" && !/anthropic/i.test(src("README.md")) && /gemini/i.test(src("README.md")),
});
known("P2     Schema changes need a migration tool (create_all cannot alter tables)", {
  open: /create_all/.test(src("backend/app/main.py")) && !hasDir("backend/alembic"),
  fixed: hasDir("backend/alembic"),
});
known("P1-4   Some automated tests exist (frontend parser only; backend + CI still to do)", {
  open: !hasDir("backend/tests") && !readdirSync(resolve(root, "frontend/src")).some((f) => f.includes(".test.")),
  fixed: hasDir("backend/tests") || readdirSync(resolve(root, "frontend/src")).some((f) => f.includes(".test.")),
});
console.log(`\n  ${tally.OPEN} open, ${tally.fixed} fixed, ${tally.unknown} unknown (unknown = neither the bug nor the fix was recognised; look by hand)\n`);

process.exit(failed ? 1 : 0);
