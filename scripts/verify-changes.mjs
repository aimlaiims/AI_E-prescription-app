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
expect("Print template escapes user text", "frontend/src/printTemplate.js", "function escapeHtml");
expect("Print template exports buildPrintHtml", "frontend/src/printTemplate.js", "export function buildPrintHtml");
expect("DictateBar: transcript-preserving retry", "frontend/src/components/DictateBar.jsx", "lastTranscript");
expect("DictateBar: spacebar shortcut, ignores repeats", "frontend/src/components/DictateBar.jsx", /e\.code !== "Space"[\s\S]*e\.repeat/);
expect("DictateBar: spacebar ignores typing targets", "frontend/src/components/DictateBar.jsx", "isTypingTarget");
expect("FormField: failures routed to onVoiceError", "frontend/src/components/FormField.jsx", "onVoiceError(err)");
expect("ReviewPanel: multi-command parser (plural)", "frontend/src/components/ReviewPanel.jsx", "function parseVoiceCommands");
expect("ReviewPanel: old single-command parser removed", "frontend/src/components/ReviewPanel.jsx", /parseVoiceCommand\(/, { present: false });
expect("ReviewPanel: 'accept'/'except' both treated as accept", "frontend/src/components/ReviewPanel.jsx", /ACCEPT_WORDS = \[[^\]]*"except"/);
expect("ReviewPanel: 'yes'/'no' NOT command words", "frontend/src/components/ReviewPanel.jsx", /(ACCEPT|REJECT)_WORDS = \[[^\]]*"(yes|no)"/, { present: false });
expect("ReviewPanel: locale from navigator.language", "frontend/src/components/ReviewPanel.jsx", "navigator.language");
expect("ReviewPanel: delayed recognizer restart", "frontend/src/components/ReviewPanel.jsx", "RESTART_DELAY_MS");
expect("ReviewPanel: buttons pass ids, not indexes", "frontend/src/components/ReviewPanel.jsx", "onAccept(u.id)");
expect("ReviewPanel: no debug 'Heard:' readout shown to user", "frontend/src/components/ReviewPanel.jsx", "lastHeard", { present: false });

console.log("\nFrontend — styles, config, deps");
for (const cls of [".dictate-mic-btn", ".retry-link", ".listening-dot", ".cooldown-banner", ".toolbar-row", ".paper", ".footer-actions"]) {
  expect(`styles.css defines ${cls}`, "frontend/src/styles.css", cls);
}
expect("mobile sticky footer rule present", "frontend/src/styles.css", /@media \(max-width: 639px\)[\s\S]*position: fixed/);
expect("vite: dev allowedHosts covers ngrok-free.dev", "frontend/vite.config.js", ".ngrok-free.dev");
expect("vite: separate preview block (own proxy + hosts)", "frontend/vite.config.js", /preview:\s*\{[\s\S]*allowedHosts[\s\S]*proxy/);
expect("package.json has lucide-react", "frontend/package.json", "lucide-react");

console.log(`\n${passed} passed, ${failed} failed\n`);

/* ------------------------------------------------------------------ */
console.log("Known open issues (informational — see docs/ROADMAP.md)");
function known(label, isOpen) {
  console.log(`  ${isOpen ? "⚠ OPEN " : "✔ fixed"}  ${label}`);
}
const rp = read("frontend/src/components/ReviewPanel.jsx") || "";
const app = read("frontend/src/App.jsx") || "";
const ext = read("backend/app/services/extraction.py") || "";
const voice = read("backend/app/routers/voice.py") || "";
const forms = read("backend/app/routers/forms.py") || "";
const envEx = read("backend/.env.example") || "";
const cfg = read("backend/app/config.py") || "";
const main = read("backend/app/main.py") || "";
const reqs = read("backend/requirements.txt") || "";
const readme = read("README.md") || "";

known("P0-1   Editing after Save: no update endpoint, Print can diverge from stored record",
  !/@router\.(put|patch)/.test(forms));
known("P0-2a  Voice 'accept age' can't target Age (label-word filter is length > 3)",
  /w\.length > 3/.test(rp));
known("P0-2c  Voice: unmatched/mumbled field name silently falls back to the TOP item",
  /working\[matchIdx !== -1 \? matchIdx : 0\]/.test(rp));
known("P0-2e  Voice: only the LAST result of an event is read (drops earlier ones)",
  /event\.results\[event\.results\.length - 1\]/.test(rp));
known("P0-3   Extraction: malformed/truncated JSON is returned as 'no updates' (silent)",
  /except \(ValueError, TypeError\):\s*\n\s*return \{"updates": \[\]/.test(ext));
known("P0-4   Same field can be pending twice (second computed against stale base)",
  !/supersede|replace.*same field/i.test(app));
known("P1-1   Sync SDK calls + time.sleep inside async routes (blocks event loop)",
  /async def (transcribe|extract)/.test(voice) && /time\.sleep/.test(ext));
known("hygiene .env.example model differs from config default",
  !(envEx.match(/EXTRACTION_MODEL=(.+)/)?.[1]?.trim() === (cfg.match(/"EXTRACTION_MODEL",\s*"([^"]+)"/)?.[1])));
known("hygiene requirements.txt pins pydantic 2.9.2 (no py3.14 wheels; needs >=2.12)",
  /pydantic==2\.9\.2/.test(reqs));
known("hygiene README still describes Claude/Anthropic extraction",
  /anthropic/i.test(readme));
known("P2     create_all() with no migration tool (schema changes need Alembic)",
  /create_all/.test(main) && !existsSync(resolve(root, "backend/alembic")));
known("P1-4   No automated tests",
  !existsSync(resolve(root, "backend/tests")) && !readdirSync(resolve(root, "frontend/src")).some((f) => f.includes(".test.")));

process.exit(failed ? 1 : 0);
