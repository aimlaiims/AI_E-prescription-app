// Port of the recovered v0 records-browser harness (records-browser-harness.zip,
// 16 checks x 2 = 32). Run: cd frontend; npm test   (Vitest + jsdom)
//
// Differences from the original, by design: filtering now happens on the
// server, so the test's parent plays the server (filters by name and by the
// "Today" chip) — the "Today shows 2 rows" check is unchanged in intent.
// Records use the repo's snake_case keys. No check was dropped.
import { describe, test, expect, beforeAll, afterEach } from "vitest";
import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import RecordsBrowser from "./RecordsBrowser.jsx";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

const TODAY = "2026-09-21";
const mk = (i, name) => ({
  pid: `RX-2026092${i}-AAAA`,
  patient_name: name,
  age: String(30 + i),
  gender: "Male",
  date: i <= 2 ? "2026-09-21" : i === 3 ? "2026-09-19" : "2026-09-10",
  chief_complaints: `c${i}`,
  on_examination: "",
  diagnosis: `Dx ${name}`,
  investigation: "",
  medications: `Tab ${name}`,
});
const RECORDS = [mk(1, "Rakesh Bansal"), mk(2, "Sunita Reddy"), mk(3, "Gopal Krishnan"), mk(4, "Priya Sharma")];

const $ = (s) => document.querySelector(s);
const rows = () => Array.from(document.querySelectorAll(".record-row"));
const key = (el, k, extra = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
const setInput = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

function makeHarness(stable) {
  return function Harness() {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [sel, setSel] = useState();
    const [flt, setFlt] = useState("all");
    const stableClose = useCallback(() => setOpen(false), []);
    const inlineClose = () => setOpen(false); // new identity every render
    // Plays the server: name search + the Today chip.
    const shown = RECORDS.filter(
      (r) =>
        r.patient_name.toLowerCase().includes(q.trim().toLowerCase()) &&
        (flt !== "today" || r.date === TODAY)
    );
    const selected = RECORDS.find((r) => r.pid === sel);
    return (
      <>
        <button id="opener" onClick={() => setOpen(true)}>
          View past prescriptions
        </button>
        {open && (
          <RecordsBrowser
            status="ready"
            records={shown}
            total={shown.length}
            query={q}
            onQuery={setQ}
            filter={flt}
            onFilter={setFlt}
            dateFrom=""
            dateTo=""
            onDateRange={() => {}}
            selectedId={sel}
            onSelect={setSel}
            preview={selected ? { status: "ready", record: selected } : { status: "idle" }}
            onPrint={() => {}}
            onClose={stable ? stableClose : inlineClose}
            onRetry={() => {}}
            onLoadMore={() => {}}
            hasMore={false}
          />
        )}
      </>
    );
  };
}

let root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

for (const stable of [false, true]) {
  describe(`parent onClose is ${stable ? "memoized (useCallback)" : "a plain function (new identity each render)"}`, () => {
    test("keyboard, focus and filtering behave (16 checks)", async () => {
      document.body.innerHTML = "<div id='root'></div>";
      root = createRoot($("#root"));
      const Harness = makeHarness(stable);
      await act(async () => root.render(<Harness />));
      const opener = $("#opener");
      opener.focus();
      await act(async () => opener.click());
      const dialog = $(".records-dialog");

      // 1-2
      expect(document.activeElement, "focus moves into the dialog on open").toBe(dialog);
      expect(document.body.style.overflow, "body scroll locked while open").toBe("hidden");

      // 3. typing keeps focus in the search box
      $(".records-search input").focus();
      await act(async () => setInput($(".records-search input"), "a"));
      expect(document.activeElement, "typing in the search box keeps focus there").toBe($(".records-search input"));
      await act(async () => setInput($(".records-search input"), ""));

      // 4. Enter on the focused 3rd row selects THAT record
      rows()[2].focus();
      await act(async () => key(rows()[2], "Enter"));
      expect($(".record-row.is-selected strong")?.textContent, "Enter on the focused 3rd row selects it").toBe("Gopal Krishnan");

      // 5-7. roving focus
      rows()[0].focus();
      await act(async () => key(rows()[0], "ArrowDown"));
      expect(document.activeElement, "ArrowDown moves focus 1 -> 2").toBe(rows()[1]);
      await act(async () => key(document.activeElement, "End"));
      expect(document.activeElement, "End jumps to the last row").toBe(rows()[rows().length - 1]);
      await act(async () => key(document.activeElement, "Home"));
      expect(document.activeElement, "Home jumps to the first row").toBe(rows()[0]);

      // 8. Space on a focused, non-selected row opens that row
      rows()[3].focus();
      await act(async () => key(rows()[3], " "));
      expect($(".record-row.is-selected strong")?.textContent, "Space on the focused 4th row selects it").toBe("Priya Sharma");

      // 9. date headings, newest first, "21 Sep 2026" format
      const heads = Array.from(document.querySelectorAll("h3.record-date-heading")).map((h) => h.textContent);
      expect(heads, "grouped under date headings, newest first").toEqual(["21 Sep 2026", "19 Sep 2026", "10 Sep 2026"]);

      // 10. preview without the standalone print toolbar
      const srcdoc = $("iframe.records-frame")?.getAttribute("srcdoc") || "";
      expect(srcdoc.includes("Priya Sharma") && !srcdoc.includes('class="toolbar"'), "preview shows the record without the print toolbar").toBe(true);

      // 11. Today chip
      await act(async () => Array.from(document.querySelectorAll(".record-filters button")).find((b) => b.textContent === "Today").click());
      expect(rows().length, "'Today' shows the 2 records dated 21 Sep").toBe(2);
      await act(async () => Array.from(document.querySelectorAll(".record-filters button")).find((b) => b.textContent === "All").click());

      // 12. live region holds only the count
      expect($('[aria-live="polite"]')?.textContent === "4 records" && !$(".records-list[aria-live]"), "aria-live region holds only the count").toBe(true);

      // 13. focus trap
      const focusables = Array.from(dialog.querySelectorAll("button, input, select, iframe, [tabindex]:not([tabindex='-1'])")).filter((e) => !e.hasAttribute("disabled"));
      focusables[focusables.length - 1].focus();
      await act(async () => key(focusables[focusables.length - 1], "Tab"));
      expect(document.activeElement, "Tab from the last control wraps to the first").toBe(focusables[0]);

      // 14-16. Esc closes, focus returns, scroll unlocked
      await act(async () => key(document.body, "Escape"));
      expect($(".records-dialog"), "Esc closes the dialog").toBeNull();
      expect(document.activeElement, "focus RETURNS to the 'View past prescriptions' button").toBe(opener);
      expect(document.body.style.overflow, "body scroll unlocked after close").toBe("");
    });
  });
}

describe("states", () => {
  const base = {
    records: [], total: 0, query: "", onQuery() {}, filter: "all", onFilter() {}, dateFrom: "", dateTo: "",
    onDateRange() {}, onSelect() {}, preview: { status: "idle" }, onPrint() {}, onClose() {}, onRetry() {},
    onLoadMore() {}, hasMore: false,
  };
  const render = async (props) => {
    document.body.innerHTML = "<div id='root'></div>";
    root = createRoot($("#root"));
    await act(async () => root.render(<RecordsBrowser {...base} {...props} />));
  };

  test("empty, no-results, error and retry", async () => {
    await render({ status: "ready" });
    expect($(".records-empty").textContent).toContain("No prescriptions saved yet");
    await render({ status: "ready", query: "zz" });
    expect($(".records-empty").textContent).toContain('No matches for "zz"');
    let retried = false;
    await render({ status: "error", onRetry: () => (retried = true) });
    await act(async () => $(".records-empty button").click());
    expect(retried).toBe(true);
  });

  test("print buttons: header + phone variants exist only when a record is shown", async () => {
    await render({ status: "ready", records: RECORDS, selectedId: RECORDS[0].pid });
    expect($(".print-record")).toBeNull();
    expect($(".phone-print")).toBeNull();
    let printed;
    await render({ status: "ready", records: RECORDS, selectedId: RECORDS[0].pid, preview: { status: "ready", record: RECORDS[0] }, onPrint: (r) => (printed = r) });
    await act(async () => $(".phone-print").click());
    expect(printed?.pid).toBe(RECORDS[0].pid);
    // Which one is visible per screen width is CSS; checked in real Chrome.
    expect($(".print-record")).not.toBeNull();
  });
});
