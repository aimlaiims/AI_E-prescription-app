// Run: cd frontend; npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrintHtml } from "./printTemplate.js";

const full = {
  patient_name: "Rakesh Bansal",
  date: "2026-09-28",
  age: "42",
  gender: "Male",
  chief_complaints: "Fever, cough\nChest congestion",
  on_examination: "",
  diagnosis: "Acute bronchitis",
  investigation: "",
  medications: "Tab. Azithromycin 500mg — 1-0-0 for 3 days",
};
const html = (state = full, opts) => buildPrintHtml(state, "RX-20260928-K3F9", { printedAt: "x", ...opts });

test("is a complete document with the record's values", () => {
  const h = html();
  assert.ok(h.startsWith("<!doctype html>"));
  for (const v of ["Rakesh Bansal", "42 / Male", "28 Sep 2026", "Acute bronchitis", "RX-20260928-K3F9", "Azithromycin"]) {
    assert.ok(h.includes(v), v);
  }
});

test("keeps line breaks the doctor entered", () => {
  assert.ok(html().includes("Fever, cough<br>Chest congestion"));
});

test("empty optional sections are omitted", () => {
  const h = html();
  assert.ok(!h.includes(">On examination<"));
  assert.ok(!h.includes(">Investigation<"));
  assert.ok(h.includes(">Chief complaints<"));
});

test("empty medications prints a clear message", () => {
  assert.ok(html({ ...full, medications: "  " }).includes("No medications prescribed."));
});

test("blank patient fields print a dash, not nothing", () => {
  const h = html({ ...full, age: "", gender: "" });
  assert.ok(h.includes("- / -"));
});

test("user text is escaped, never interpreted as HTML", () => {
  const h = html({ ...full, patient_name: "<script>alert(1)</script> & co" });
  assert.ok(!h.includes("<script>alert(1)"));
  assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"));
});

test("toolbar on by default, off for an embedded preview", () => {
  assert.ok(html().includes('class="toolbar"'));
  assert.ok(!html(full, { toolbar: false }).includes('class="toolbar"'));
});

test("no letterhead configured -> no letterhead text", () => {
  const h = html();
  assert.ok(!h.includes('class="clinic"') && !h.includes('class="doctor"') && !h.includes('class="registration"'));
});

test("letterhead classes follow the field, even when one is missing", () => {
  const h = html(full, { letterhead: { doctorName: "Dr. A. Rao", registrationNo: "Reg. 123" } });
  assert.ok(h.includes('<div class="doctor">Dr. A. Rao</div>'));
  assert.ok(h.includes('<div class="registration">Reg. 123</div>'));
  assert.ok(!h.includes('class="clinic"'));
});

test("signature always shares an unbreakable block with the last medication lines", () => {
  const meds = Array.from({ length: 10 }, (_, i) => `Tab. Med ${i + 1}`).join("\n");
  const h = html({ ...full, medications: meds });
  const closing = h.slice(h.indexOf('<div class="closing'));
  assert.ok(closing.includes("Tab. Med 10") && closing.includes("Tab. Med 8"), "last 3 lines in the block");
  assert.ok(!closing.includes("Tab. Med 7<"), "earlier lines stay in the main list");
  assert.ok(closing.includes('class="signature"'));
  assert.ok(h.includes(".closing { break-inside: avoid;"));
});

test("a short list goes wholly into the closing block, with its heading", () => {
  const h = html({ ...full, medications: "Tab. A\nTab. B" });
  const closing = h.slice(h.indexOf('<div class="closing'));
  assert.ok(closing.startsWith('<div class="closing whole">'));
  assert.ok(closing.includes("℞ Medications") && closing.includes("Tab. A<br>Tab. B"));
  assert.ok(!h.includes('<section class="medications">'));
});
