// Run: cd frontend; npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { withPendingApplied, mergePending } from "./pendingUpdates.js";

let n = 0;
const makeId = () => `t${n++}`;
const upd = (field, new_value, old_value = "") => ({ field, new_value, old_value, evidence: "" });

test("withPendingApplied overlays proposals on the form", () => {
  const state = { chief_complaints: "Left ear pain", age: "30" };
  const pending = [{ id: "a", field: "chief_complaints", new_value: "Left ear pain\nFever" }];
  assert.deepEqual(withPendingApplied(state, pending), {
    chief_complaints: "Left ear pain\nFever",
    age: "30",
  });
  assert.equal(state.chief_complaints, "Left ear pain", "input not mutated");
});

test("new field is appended with an id and supersedes=false", () => {
  const out = mergePending([], [upd("age", "34")], { age: "" }, makeId);
  assert.equal(out.length, 1);
  assert.equal(out[0].field, "age");
  assert.equal(out[0].supersedes, false);
  assert.ok(out[0].id);
});

test("P0-4: second proposal for the same field replaces the first", () => {
  const prev = [{ id: "a", field: "chief_complaints", new_value: "Ear pain\nFever", old_value: "Ear pain" }];
  const out = mergePending(prev, [upd("chief_complaints", "Ear pain\nFever\nCough", "Ear pain\nFever")],
    { chief_complaints: "Ear pain" }, makeId);
  assert.equal(out.length, 1);
  assert.equal(out[0].new_value, "Ear pain\nFever\nCough");
  assert.equal(out[0].supersedes, true);
  // "old" shown to the doctor is the real form value, not the earlier proposal
  assert.equal(out[0].old_value, "Ear pain");
});

test("other pending fields are kept, in order", () => {
  const prev = [
    { id: "a", field: "age", new_value: "34" },
    { id: "b", field: "diagnosis", new_value: "Flu" },
  ];
  const out = mergePending(prev, [upd("age", "35")], { age: "" }, makeId);
  assert.deepEqual(out.map((u) => [u.field, u.new_value]), [["diagnosis", "Flu"], ["age", "35"]]);
});

test("two updates for one field in the same batch: last wins", () => {
  const out = mergePending([], [upd("age", "34"), upd("age", "35")], { age: "" }, makeId);
  assert.deepEqual(out.map((u) => u.new_value), ["35"]);
});

test("accept-all over merged list applies each field exactly once", () => {
  let pending = mergePending([], [upd("diagnosis", "Flu"), upd("age", "34")], {}, makeId);
  pending = mergePending(pending, [upd("diagnosis", "Viral fever")], {}, makeId);
  const final = withPendingApplied({ diagnosis: "", age: "" }, pending);
  assert.deepEqual(final, { diagnosis: "Viral fever", age: "34" });
});
