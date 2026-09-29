// Translates API failures (which carry technical detail useful for debugging,
// like "Gemini's free-tier rate limit was hit (429)") into plain language for
// a clinician using the prescription. Nothing from the raw error message is
// ever shown directly — only these fixed, reviewed strings.
//
// `context` distinguishes what the doctor was doing when the error hit, so
// the wording doesn't say "voice input" for a failure that had nothing to do
// with the microphone (e.g. saving or printing).

const VOICE_MESSAGES = {
  rate_limited:
    "Voice input is in high demand right now and needs a short break. It will resume automatically — no need to do anything.",
  unavailable:
    "Voice input isn't responding at the moment. Please try again in a moment, or fill this field in by typing.",
  auth:
    "Voice input isn't set up correctly on this device. Please let whoever manages this software know.",
  default:
    "Something interrupted voice input. Please try again, or fill this field in by typing.",
};

const SAVE_MESSAGES = {
  rate_limited:
    "Saving is in high demand right now and needs a short break. It will resume automatically — no need to do anything.",
  unavailable:
    "Couldn't reach the server to save this prescription. Please check your connection and try again.",
  auth:
    "This device isn't set up correctly to save prescriptions. Please let whoever manages this software know.",
  default:
    "Something went wrong while saving. Please try again.",
};

const PRINT_MESSAGES = {
  rate_limited:
    "Printing is in high demand right now and needs a short break. It will resume automatically — no need to do anything.",
  unavailable:
    "Couldn't reach the server to prepare this prescription for printing. Please check your connection and try again.",
  auth:
    "This device isn't set up correctly to save prescriptions before printing. Please let whoever manages this software know.",
  default:
    "Something went wrong while preparing this prescription for printing. Please try again.",
};

// Microphone access/device failures — distinct from server-side voice
// processing failures above, since these never reach the network at all.
const MIC_MESSAGES = {
  mic_permission_denied:
    "Microphone access is blocked for this page. Allow microphone access from your browser's address bar, then try again.",
  mic_not_found:
    "No microphone was found on this device. Please connect a microphone, or fill this field in by typing.",
  mic_in_use:
    "The microphone couldn't be started — it may be in use by another app or tab. Close it and try again.",
  mic_insecure_context:
    "Voice input isn't available on this connection. It needs a secure (https) address to access the microphone.",
  mic_unknown:
    "Couldn't start the microphone. Please try again, or fill this field in by typing.",
};

const MESSAGES_BY_CONTEXT = {
  voice: VOICE_MESSAGES,
  save: SAVE_MESSAGES,
  print: PRINT_MESSAGES,
};

export function friendlyErrorMessage(err, context = "voice") {
  const code = err?.code || "unknown";
  if (code in MIC_MESSAGES) return MIC_MESSAGES[code];
  const messages = MESSAGES_BY_CONTEXT[context] || VOICE_MESSAGES;
  return messages[code] || messages.default;
}

export function friendlyCooldownReason() {
  return "Too many voice requests in a short time. This happens occasionally on busy days — dictation will work again automatically once the timer below reaches zero.";
}

// Hands-free confirm hit an error that retrying won't fix (mic blocked for
// speech recognition, no connection to the browser's speech service...).
export const HANDS_FREE_UNAVAILABLE_MESSAGE =
  "Hands-free confirm stopped: the browser couldn't listen for commands. Tap Accept or Discard instead, or turn hands-free on again to retry.";

// Saving locks the prescription, so anything still waiting for review would
// be silently left out of it.
export const PENDING_BEFORE_SAVE_MESSAGE =
  "Some dictated details are still waiting for review. Accept or discard them before saving.";

// Shared between the whole-form mic and each per-field mic, so both
// experiences read the same way instead of drifting apart over time.
export const EMPTY_TRANSCRIPT_MESSAGE = "Didn't catch anything — tap the mic to try again.";

export function noMatchMessage(fieldLabel) {
  return fieldLabel
    ? `Didn't find anything for ${fieldLabel}. Try stating it plainly and try again.`
    : "Didn't find anything that clearly fits a field. Try naming what you're describing, like \"diagnosis is...\"";
}
