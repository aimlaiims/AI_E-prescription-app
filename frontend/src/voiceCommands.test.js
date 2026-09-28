// Run: cd frontend; npm test   (Node's built-in runner, no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVoiceCommands } from "./voiceCommands.js";

const pending = [
  { id: "u0", field: "patient_name" },
  { id: "u1", field: "age" },
  { id: "u2", field: "gender" },
  { id: "u3", field: "on_examination" },
  { id: "u4", field: "diagnosis" },
];
const parse = (text, p = pending) => parseVoiceCommands(text, p);

// The P0-2 table from docs/ROADMAP.md — these were the real failures.
test("'accept age' targets age (was: top item)", () => {
  assert.deepEqual(parse("accept age"), { commands: [{ action: "accept", id: "u1" }], unmatched: false });
});
test("'accept exam' targets on_examination (was: top item)", () => {
  assert.deepEqual(parse("accept exam").commands, [{ action: "accept", id: "u3" }]);
});
test("misheard field name accepts nothing and says so (was: top item)", () => {
  assert.deepEqual(parse("accept dignosis"), { commands: [], unmatched: true });
});
test("'accept gender' / 'accept examination' still work", () => {
  assert.deepEqual(parse("accept gender").commands, [{ action: "accept", id: "u2" }]);
  assert.deepEqual(parse("accept examination").commands, [{ action: "accept", id: "u3" }]);
});

test("bare command acts on the top item", () => {
  assert.deepEqual(parse("accept").commands, [{ action: "accept", id: "u0" }]);
  assert.deepEqual(parse("discard").commands, [{ action: "reject", id: "u0" }]);
});
test("filler words after a command still count as bare", () => {
  assert.deepEqual(parse("accept this one please").commands, [{ action: "accept", id: "u0" }]);
});
test("filler around a field name is ignored", () => {
  assert.deepEqual(parse("accept the diagnosis please").commands, [{ action: "accept", id: "u4" }]);
});
test("punctuation from the recognizer does not matter", () => {
  assert.deepEqual(parse("Accept, diagnosis.").commands, [{ action: "accept", id: "u4" }]);
});
test("aliases: sex -> gender, dx -> diagnosis, o/e -> on_examination", () => {
  assert.deepEqual(parse("accept sex").commands, [{ action: "accept", id: "u2" }]);
  assert.deepEqual(parse("accept dx").commands, [{ action: "accept", id: "u4" }]);
  assert.deepEqual(parse("accept o/e").commands, [{ action: "accept", id: "u3" }]);
});
test("whole-word match only: 'image' does not name age", () => {
  assert.deepEqual(parse("accept image"), { commands: [], unmatched: true });
});
test("field named but not pending -> nothing, unmatched", () => {
  assert.deepEqual(parse("accept medications"), { commands: [], unmatched: true });
});

test("chained commands in one breath all apply, in order", () => {
  assert.deepEqual(parse("accept diagnosis accept age discard gender").commands, [
    { action: "accept", id: "u4" },
    { action: "accept", id: "u1" },
    { action: "reject", id: "u2" },
  ]);
});
test("two bare accepts claim two different items", () => {
  assert.deepEqual(parse("accept accept").commands, [
    { action: "accept", id: "u0" },
    { action: "accept", id: "u1" },
  ]);
});
test("'accept all' and misheard 'except all'", () => {
  assert.deepEqual(parse("accept all").commands, [{ action: "acceptAll" }]);
  assert.deepEqual(parse("except all").commands, [{ action: "acceptAll" }]);
});
test("targeted accepts then accept all", () => {
  assert.deepEqual(parse("accept diagnosis accept age accept all").commands, [
    { action: "accept", id: "u4" },
    { action: "accept", id: "u1" },
    { action: "acceptAll" },
  ]);
});
test("reject synonyms", () => {
  for (const w of ["reject", "discard", "skip", "wrong", "cancel", "remove"]) {
    assert.deepEqual(parse(`${w} age`).commands, [{ action: "reject", id: "u1" }], w);
  }
});
test("ordinary speech with no command word does nothing", () => {
  assert.deepEqual(parse("no wait let me check the chart"), { commands: [], unmatched: false });
  assert.deepEqual(parse("yes that looks fine"), { commands: [], unmatched: false });
});
test("one bad target does not block a good one in the same utterance", () => {
  assert.deepEqual(parse("accept dignosis accept age"), {
    commands: [{ action: "accept", id: "u1" }],
    unmatched: true,
  });
});
test("same field pending twice: first one is taken first", () => {
  const p = [{ id: "a", field: "age" }, { id: "b", field: "age" }];
  assert.deepEqual(parse("accept age accept age", p).commands, [
    { action: "accept", id: "a" },
    { action: "accept", id: "b" },
  ]);
});
test("'patient name' prefers the longer alias", () => {
  assert.deepEqual(parse("accept patient name").commands, [{ action: "accept", id: "u0" }]);
});
