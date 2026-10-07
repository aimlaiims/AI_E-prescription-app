import { FIELD_SPECS } from "./fieldSpecs.js";
import { appTimeParts } from "./dates.js";

// Standalone A4 prescription document (opened in its own window, or shown in
// an iframe). Design ported from the recovered v0 print-html: grayscale,
// signature kept on the same page as the content, "-" for blank patient
// fields, letterhead classes assigned by FIELD NAME (never by index after
// dropping missing ones — that mis-styled whichever field was absent).

// Escapes user-entered text before it's embedded into a raw HTML string —
// this document is built by string concatenation (not JSX), so this is the
// only thing standing between a patient's typed/dictated text and it being
// interpreted as HTML.
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Keeps the doctor's own line breaks (e.g. one medicine per line).
function multiline(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

// Fixed month names: toLocaleDateString("en-GB") now gives "Sept" in current
// Chrome/Node, and the output would otherwise depend on the browser's
// locale data. Always "28 Sep 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

export function formatDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return isoDate || "";
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// In IST, whatever timezone the printing device is set to.
export function formatDateTime(d) {
  const t = appTimeParts(d);
  return `${pad2(t.day)} ${MONTHS[t.month - 1]} ${t.year}, ${pad2(t.hour)}:${pad2(t.minute)}`;
}

/**
 * @param state  form values (snake_case keys, see fieldSpecs.js)
 * @param pid    Reference ID
 * @param opts.toolbar     Close/Print buttons on screen (hidden when printing).
 *                         Off for an embedded preview.
 * @param opts.letterhead  { clinicName?, departmentName?, doctorName?, registrationNo?, logoDataUri? }
 *                         Nothing configured -> no letterhead text at all.
 * @param opts.printedAt   override for tests; defaults to now
 * @param opts.patientLabel  our Patient ID (e.g. ENT-000123); a stored record
 *                         carries it as `patient_label`
 */
export function buildPrintHtml(state, pid, { toolbar = true, letterhead = {}, printedAt, patientLabel } = {}) {
  const printed = printedAt || formatDateTime(new Date());
  const text = (k) => String(state[k] ?? "").trim();
  const orDash = (v) => v || "-";

  // Patient ID, OPD No., City, Occupation — whichever are known.
  const identity = [
    ["Patient ID", String(patientLabel || state.patient_label || "").trim()],
    [FIELD_SPECS.opd_no.label, text("opd_no")],
    [FIELD_SPECS.city.label, text("city")],
    [FIELD_SPECS.occupation.label, text("occupation")],
  ]
    .filter(([, v]) => v)
    .map(([label, v]) => `<span><span class="label">${escapeHtml(label)}</span> ${escapeHtml(v)}</span>`)
    .join("");

  // Empty optional sections are omitted — an empty heading wastes paper.
  const sections = ["chief_complaints", "on_examination", "diagnosis", "investigation"]
    .filter((k) => text(k))
    .map(
      (k) =>
        `<section class="clinical-section"><h2>${escapeHtml(FIELD_SPECS[k].label)}</h2><p>${multiline(text(k))}</p></section>`
    )
    .join("");

  // The signature must never end up alone on a page. Chrome ignores
  // "break-before: avoid" when honouring it would split a block, so the LAST
  // few medication lines and the signature share one unbreakable block: when
  // the page runs out, they move to the next page together. (Checked by
  // rendering PDFs in Chrome across 1-44 medication lines.)
  const TAIL_LINES = 3;
  const medLines = text("medications")
    ? text("medications").split(/\r?\n/).map(escapeHtml)
    : ["<em>No medications prescribed.</em>"];
  const headLines = medLines.slice(0, Math.max(0, medLines.length - TAIL_LINES));
  const tailLines = medLines.slice(headLines.length);
  const medsHeading = `<h2>℞ ${escapeHtml(FIELD_SPECS.medications.label)}</h2>`;

  const logo = letterhead.logoDataUri
    ? `<img class="logo" src="${escapeHtml(letterhead.logoDataUri)}" alt="Clinic logo">`
    : "";
  const letterheadDetails = [
    letterhead.clinicName && `<div class="clinic">${escapeHtml(letterhead.clinicName)}</div>`,
    letterhead.departmentName && `<div class="department">${escapeHtml(letterhead.departmentName)}</div>`,
    letterhead.doctorName && `<div class="doctor">${escapeHtml(letterhead.doctorName)}</div>`,
    letterhead.registrationNo &&
      `<div class="registration">${escapeHtml(letterhead.registrationNo)}</div>`,
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prescription — ${escapeHtml(text("patient_name") || "Patient")} — ${escapeHtml(pid)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; }
.sheet { max-width: 720px; margin: 0 auto; padding: 16px; }
.toolbar { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #bbb; background: #f4f4f4; }
.toolbar button { min-height: 44px; padding: 8px 16px; border: 1px solid #777; border-radius: 4px; background: #fff; color: #111; font: inherit; cursor: pointer; }
.toolbar button.primary { background: #111; color: #fff; border-color: #111; }
.letterhead { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 16px; border-bottom: 2px solid #111; }
.brand { display: flex; flex: 1 1 auto; align-items: center; gap: 12px; min-width: 0; }
.rx { font: 42pt/1 Georgia, serif; }
.clinic { font: bold 15pt/1.25 Georgia, serif; }
.department { margin-top: 2px; font-weight: 600; }
.doctor, .registration { margin-top: 3px; color: #444; }
.logo { width: 58px; height: 58px; object-fit: contain; }
.meta { flex: 0 0 auto; text-align: right; font: 10pt/1.5 "Courier New", monospace; }
.patient-row { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 18px; padding: 20px 0 12px; }
.patient-ids { display: flex; flex-wrap: wrap; gap: 6px 22px; padding-bottom: 14px; border-bottom: 1px solid #bbb; font-size: 10.5pt; }
.patient-ids .label { display: inline; margin-right: 4px; }
.label { display: block; margin-bottom: 4px; color: #555; font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; }
.value { font-weight: bold; overflow-wrap: anywhere; }
.clinical-section { break-inside: avoid; padding: 14px 0; border-bottom: 1px solid #bbb; }
.clinical-section h2 { margin: 0 0 6px; font: bold 9pt Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.clinical-section p { margin: 0; overflow-wrap: anywhere; }
/* One bordered box drawn as two parts: .medications (heading + all but the
   last lines, may split across pages) and .medications-tail (last lines),
   which sits inside .closing together with the signature. */
.medications { margin-top: 16px; padding: 12px 12px 0; border: 1px solid #111; border-bottom: 0; }
.medications h2, .medications-tail h2 { margin: 0 0 10px; font: bold 12pt Georgia, serif; break-after: avoid; }
.medication-lines { font: 11pt/1.6 "Courier New", monospace; overflow-wrap: anywhere; }
.medication-lines em { color: #555; font-family: Arial, sans-serif; }
.closing { break-inside: avoid; page-break-inside: avoid; }
.medications-tail { padding: 0 12px 12px; border: 1px solid #111; border-top: 0; }
.closing.whole .medications-tail { margin-top: 16px; padding-top: 12px; border-top: 1px solid #111; }
.footer { display: flex; justify-content: space-between; gap: 28px; align-items: end; margin-top: 20px; font-size: 8.5pt; }
.fine-print { max-width: 65%; color: #555; }
.signature { width: 150px; text-align: center; }
.signature-line { height: 34px; border-bottom: 1px solid #111; }
.signature-caption { margin-top: 5px; }
@media print { .toolbar { display: none; } .sheet { max-width: none; padding: 0; } }
@media (max-width: 600px) {
  .letterhead, .footer { flex-direction: column; }
  .meta { text-align: left; }
  .patient-row { grid-template-columns: 1fr 1fr; }
  .patient-row > :first-child { grid-column: 1 / -1; }
  .fine-print { max-width: none; }
}
</style></head><body>
${toolbar ? '<div class="toolbar"><button type="button" onclick="window.close()">Close</button><button type="button" class="primary" onclick="window.print()">Print</button></div>' : ""}
<div class="sheet">
<header class="letterhead"><div class="brand">${logo || '<div class="rx" aria-hidden="true">℞</div>'}<div>${letterheadDetails}</div></div><div class="meta"><div>Reference ID: ${escapeHtml(pid)}</div><div>Printed: ${escapeHtml(printed)}</div></div></header>
<div class="patient-row"><div><span class="label">${escapeHtml(FIELD_SPECS.patient_name.label)}</span><span class="value">${escapeHtml(orDash(text("patient_name")))}</span></div><div><span class="label">${escapeHtml(FIELD_SPECS.age.label)} / ${escapeHtml(FIELD_SPECS.gender.label)}</span><span class="value">${escapeHtml(orDash(text("age")))} / ${escapeHtml(orDash(text("gender")))}</span></div><div><span class="label">${escapeHtml(FIELD_SPECS.date.label)}</span><span class="value">${escapeHtml(orDash(formatDate(text("date"))))}</span></div></div><div class="patient-ids">${identity}</div>
${sections}${headLines.length ? `<section class="medications">${medsHeading}<div class="medication-lines">${headLines.join("<br>")}</div></section>` : ""}
<div class="closing${headLines.length ? "" : " whole"}"><div class="medications-tail">${headLines.length ? "" : medsHeading}<div class="medication-lines">${tailLines.join("<br>")}</div></div>
<footer class="footer"><div class="fine-print">This is a computer-generated prescription record. Reference ID ${escapeHtml(pid)} can be used to retrieve this record.</div><div class="signature"><div class="signature-line"></div><div class="signature-caption">Signature</div></div></footer></div>
</div>
</body></html>`;
}
