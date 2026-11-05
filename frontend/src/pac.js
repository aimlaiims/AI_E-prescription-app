// PAC (pre-anaesthetic check-up) investigations, from the ENT department
// (2026-10-29). The doctor picks the type of anaesthesia, ticks the tests, and
// one line is added to Investigation — so it prints, and shows in history,
// like anything typed there. To change a list: edit it here (no other code).
//   routine: ticked when the list opens; `when`: the condition, shown next to
//   a test that starts unticked (the doctor decides).
export const PAC_OPTIONS = [
  {
    id: "local",
    label: "Local anaesthesia",
    tests: [
      { name: "CBC", routine: true },
      { name: "LFT", routine: true },
      { name: "RFT", routine: true },
      { name: "PT/INR", routine: true },
      { name: "APTT", routine: true },
      { name: "HIV/HBsAg/HCV", routine: true },
      { name: "ECG", routine: true },
    ],
  },
  {
    id: "general",
    label: "General anaesthesia",
    tests: [
      { name: "CBC", routine: true },
      { name: "LFT", routine: true },
      { name: "RFT", routine: true },
      { name: "PT/INR", routine: true },
      { name: "APTT", routine: true },
      { name: "HIV/HBsAg/HCV", routine: true },
      { name: "ECG", routine: true },
      { name: "Chest X-ray", routine: true },
      { name: "HbA1c", routine: true },
      { name: "FBS", routine: true },
      { name: "PPBS", routine: true },
      { name: "TFT", when: "for carcinoma and thyroid cases" },
      { name: "Calcium profile", when: "for thyroid cases" },
    ],
  },
];

const PAC_LINE = /^PAC \(.*\):/;

// "PAC (general anaesthesia): CBC, LFT, ..." for the ticked tests, in list order.
export function pacLine(option, ticked) {
  const names = option.tests.map((t) => t.name).filter((n) => ticked.has(n));
  return names.length ? `PAC (${option.label.toLowerCase()}): ${names.join(", ")}` : "";
}

// The choice behind an existing PAC line, so opening the list again shows it
// as it was: { option, ticked }, or the tests that start ticked if none.
export function pacChoice(investigation, option) {
  const line = (investigation || "").split(/\r?\n/).map((l) => l.trim()).find((l) => PAC_LINE.test(l));
  const found = line && PAC_OPTIONS.find((o) => line.startsWith(`PAC (${o.label.toLowerCase()}):`));
  if (found && (!option || found === option)) {
    const names = line.slice(line.indexOf(":") + 1).split(",").map((n) => n.trim());
    return { option: found, ticked: new Set(found.tests.map((t) => t.name).filter((n) => names.includes(n))) };
  }
  const chosen = option || null;
  return { option: chosen, ticked: new Set(chosen ? chosen.tests.filter((t) => t.routine).map((t) => t.name) : []) };
}

// Investigation with the PAC line added at the end, or replacing an earlier
// PAC line (choosing again changes the order instead of adding a second one).
export function withPacLine(investigation, line) {
  const lines = (investigation || "").split(/\r?\n/);
  const at = lines.findIndex((l) => PAC_LINE.test(l.trim()));
  if (at >= 0) {
    if (line) lines[at] = line;
    else lines.splice(at, 1);
  } else if (line) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(line);
  }
  return lines.join("\n").replace(/^\n+/, "");
}
