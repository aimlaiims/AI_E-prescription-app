// Run: cd frontend; npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dateBounds, localToday } from "./dates.js";

test("localToday uses the local calendar date", () => {
  assert.equal(localToday(new Date(2026, 8, 29, 2, 30)), "2026-09-29");
});

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-09-29", -6), "2026-09-23");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-01-02", -6), "2025-12-27");
});

test("filter chips and From/To combine; the tighter bound wins", () => {
  const t = "2026-09-29";
  assert.deepEqual(dateBounds("all", "", "", t), { date_from: "", date_to: "" });
  assert.deepEqual(dateBounds("today", "", "", t), { date_from: t, date_to: t });
  assert.deepEqual(dateBounds("week", "", "", t), { date_from: "2026-09-23", date_to: t });
  assert.deepEqual(dateBounds("week", "2026-09-25", "", t), { date_from: "2026-09-25", date_to: t });
  assert.deepEqual(dateBounds("all", "2026-01-01", "2026-02-01", t), { date_from: "2026-01-01", date_to: "2026-02-01" });
});
