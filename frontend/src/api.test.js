// Run: cd frontend; npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFileName } from "./api.js";

test("upload name matches what the browser recorded", () => {
  assert.equal(audioFileName({ type: "audio/webm;codecs=opus" }), "clip.webm"); // Chrome/Edge
  assert.equal(audioFileName({ type: "audio/mp4" }), "clip.mp4"); // Safari / iPhone
  assert.equal(audioFileName({ type: "audio/ogg;codecs=opus" }), "clip.ogg"); // Firefox
  assert.equal(audioFileName({ type: "" }), "clip.webm");
  assert.equal(audioFileName(null), "clip.webm");
});
