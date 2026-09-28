import { FIELD_SPECS } from "./fieldSpecs.js";

// Escapes user-entered text before it's embedded into a raw HTML string —
// this document is built by string concatenation (not JSX), so this is the
// only thing standing between a patient's typed/dictated text and it being
// interpreted as HTML.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Turns multi-line textarea content into separate paragraph-safe lines,
// preserving line breaks the doctor actually entered (e.g. one medication
// per line) rather than collapsing everything into a single run-on line.
function multilineHtml(value) {
  return escapeHtml(value)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => `<div class="line">${line}</div>`)
    .join("");
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// A section is only printed if it has content — an empty "Investigation"
// header with nothing under it just wastes paper and looks unfinished.
function section(label, value) {
  if (!value || !value.trim()) return "";
  return `
    <div class="block">
      <div class="block-label">${escapeHtml(label)}</div>
      <div class="block-value">${multilineHtml(value)}</div>
    </div>`;
}

export function buildPrintHtml(state, pid) {
  const printedAt = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const medicationsHtml = state.medications && state.medications.trim()
    ? multilineHtml(state.medications)
    : `<div class="line muted">No medications prescribed.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Prescription — ${escapeHtml(state.patient_name || "Patient")} — ${escapeHtml(pid)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    color: #17202a;
    font-size: 12pt;
    line-height: 1.5;
  }
  .toolbar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    background: #f0efe8;
    border-bottom: 1px solid #d8d5cc;
    font-family: Arial, Helvetica, sans-serif;
  }
  .toolbar button {
    font-family: inherit;
    font-size: 13px;
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid #c9c6bc;
    background: #ffffff;
    cursor: pointer;
  }
  .toolbar button.primary { background: #17202a; color: #fff; border-color: #17202a; }
  @media print { .toolbar { display: none; } }

  .sheet { max-width: 720px; margin: 0 auto; padding: 28px 8px 40px; }

  .letterhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    border-bottom: 2px solid #17202a;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  .rx-mark { font-size: 30px; font-weight: 700; }
  .doc-meta { text-align: right; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #4a5b6b; }
  .doc-meta .ref { font-family: "Courier New", monospace; font-weight: 700; color: #17202a; }

  .patient-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 14px;
    padding: 12px 0 18px;
    border-bottom: 1px solid #d8d5cc;
    margin-bottom: 18px;
    font-family: Arial, Helvetica, sans-serif;
  }
  .patient-field .k { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7a86; margin-bottom: 3px; }
  .patient-field .v { font-size: 12.5pt; font-weight: 700; }

  .block { margin-bottom: 16px; break-inside: avoid; }
  .block-label {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7a86;
    margin-bottom: 5px;
    border-bottom: 1px solid #e4e2d8;
    padding-bottom: 3px;
  }
  .block-value .line { margin-bottom: 2px; }
  .block-value .line.muted { color: #8a95a0; font-style: italic; }

  .rx-symbol { font-size: 20px; font-weight: 700; margin-right: 6px; }
  .medications-box {
    border: 1px solid #d8d5cc;
    border-radius: 4px;
    padding: 14px 16px;
    margin-top: 4px;
    background: #fbfaf6;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 48px;
    padding-top: 14px;
    border-top: 1px solid #d8d5cc;
    font-family: Arial, Helvetica, sans-serif;
  }
  .footer .fine-print { font-size: 8.5pt; color: #8a95a0; max-width: 60%; }
  .signature { text-align: center; }
  .signature .line-rule { width: 180px; border-top: 1px solid #4a5b6b; margin-bottom: 4px; }
  .signature .caption { font-size: 9pt; color: #6b7a86; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print</button>
  </div>

  <div class="sheet">
    <div class="letterhead">
      <span class="rx-mark">℞</span>
      <div class="doc-meta">
        <div>Reference ID: <span class="ref">${escapeHtml(pid)}</span></div>
        <div>Printed: ${escapeHtml(printedAt)}</div>
      </div>
    </div>

    <div class="patient-row">
      <div class="patient-field">
        <div class="k">${escapeHtml(FIELD_SPECS.patient_name.label)}</div>
        <div class="v">${escapeHtml(state.patient_name || "—")}</div>
      </div>
      <div class="patient-field">
        <div class="k">${escapeHtml(FIELD_SPECS.age.label)} / ${escapeHtml(FIELD_SPECS.gender.label)}</div>
        <div class="v">${escapeHtml(state.age || "—")} / ${escapeHtml(state.gender || "—")}</div>
      </div>
      <div class="patient-field">
        <div class="k">${escapeHtml(FIELD_SPECS.date.label)}</div>
        <div class="v">${escapeHtml(formatDate(state.date) || "—")}</div>
      </div>
    </div>

    ${section(FIELD_SPECS.chief_complaints.label, state.chief_complaints)}
    ${section(FIELD_SPECS.on_examination.label, state.on_examination)}
    ${section(FIELD_SPECS.diagnosis.label, state.diagnosis)}
    ${section(FIELD_SPECS.investigation.label, state.investigation)}

    <div class="block">
      <div class="block-label"><span class="rx-symbol">℞</span>Medications</div>
      <div class="medications-box">${medicationsHtml}</div>
    </div>

    <div class="footer">
      <div class="fine-print">
        This is a computer-generated prescription record. Reference ID ${escapeHtml(pid)}
        can be used to retrieve this record.
      </div>
      <div class="signature">
        <div class="line-rule"></div>
        <div class="caption">Signature</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}