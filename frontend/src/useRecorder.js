import { useRef, useState, useCallback, useEffect } from "react";

// Thrown by start() for anything that stops the microphone from starting —
// permission denial, no device, device busy, or an insecure origin. Kept as a
// small duck-typed {code, message} error (not api.js's ApiError, since this
// never touches the network) so it drops straight into the same
// friendlyErrorMessage(err) handling every other voice error already uses.
export class MicError extends Error {
  constructor(message, code = "mic_unknown") {
    super(message);
    this.code = code;
  }
}

function classifyMicError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "mic_permission_denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "mic_not_found";
    case "NotReadableError":
    case "TrackStartError":
      return "mic_in_use";
    case "SecurityError":
      return "mic_insecure_context";
    default:
      return "mic_unknown";
  }
}

// Wraps MediaRecorder. Returns a promise-based start/stop so callers can
// `await stop()` and get the recorded Blob directly, instead of juggling
// event listeners at every call site.
export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  // True from the moment start() is called until it finishes. A second tap
  // while the browser's permission prompt is still open would otherwise open
  // a second mic stream that nothing ever stops (mic light stuck on).
  const startingRef = useRef(false);
  const unmountedRef = useRef(false);

  // Resolves true if recording started, false if the call was ignored
  // (already starting/recording, or the component unmounted meanwhile).
  const start = useCallback(async () => {
    if (startingRef.current || mediaRecorderRef.current?.state === "recording") return false;
    startingRef.current = true;
    try {
      return await startRecording();
    } finally {
      startingRef.current = false;
    }
  }, []);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Missing entirely on an insecure origin (non-HTTPS, non-localhost) or
      // an unsupported browser — there's no DOMException to classify here.
      throw new MicError(
        "Microphone access isn't available on this connection.",
        "mic_insecure_context"
      );
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw new MicError(err.message, classifyMicError(err));
    }
    if (unmountedRef.current) {
      // The component went away while the permission prompt was open.
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    return true;
  };

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") return resolve(null);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  // Release the microphone if the component using it goes away mid-recording
  // (e.g. the whole-visit mic is removed when a saved form locks) — otherwise
  // the browser keeps the mic open with nothing listening to it.
  useEffect(() => {
    unmountedRef.current = false; // StrictMode mounts twice in dev
    return () => {
      unmountedRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { isRecording, start, stop };
}
