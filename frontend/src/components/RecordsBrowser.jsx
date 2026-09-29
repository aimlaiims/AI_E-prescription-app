import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Printer, Search, X } from "lucide-react";
import { buildPrintHtml, formatDate } from "../printTemplate.js";

// "View past prescriptions" dialog. Presentational: RecordsDialog.jsx owns the
// server calls (search, filters, paging) and passes the results in, already
// filtered and newest first. Ported from the recovered v0 component; its
// keyboard/focus behaviour is covered by RecordsBrowser.test.jsx:
//   focus moves in on open and returns on close, Tab is trapped, Esc closes,
//   page scroll is locked while open, typing in search never loses focus,
//   rows use roving focus (arrows / Home / End) and Enter/Space open the
//   FOCUSED row (the first v0 version opened a different patient's record).

// A4 at 96dpi — the size the preview document is laid out at.
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

const FILTERS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "all", label: "All" },
];

export default function RecordsBrowser({
  status, // "loading" | "error" | "ready"
  records,
  total,
  query,
  onQuery,
  filter,
  onFilter,
  dateFrom,
  dateTo,
  onDateRange,
  selectedId,
  onSelect,
  preview, // { status: "idle" | "loading" | "error" | "ready", record? }
  notice, // e.g. pop-up blocked when printing
  onPrint,
  onClose,
  onRetry,
  onLoadMore,
  hasMore,
}) {
  const dialogRef = useRef(null);
  const listRef = useRef(null);
  const frameShellRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Phones show one pane at a time: the list, or (after picking) the preview.
  const [phonePreview, setPhonePreview] = useState(false);

  const record = preview?.status === "ready" ? preview.record : null;

  // Open/close lifecycle: focus in, scroll lock, Esc, focus trap, focus return.
  // Runs once — onClose is read through a ref so a parent passing a new
  // function every render doesn't re-run this (which would steal focus).
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab" && dialog) {
        const focusable = Array.from(
          dialog.querySelectorAll("button, input, select, iframe, [tabindex]:not([tabindex='-1'])")
        ).filter(
          // Skip disabled controls and ones hidden by CSS (e.g. the other
          // pane on a phone); where checkVisibility is missing, assume visible.
          (el) => !el.hasAttribute("disabled") && (el.checkVisibility?.() ?? true)
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  // Scale the A4 preview to the pane width (never up), recomputed on resize.
  useEffect(() => {
    const shell = frameShellRef.current;
    if (!shell) return;
    const update = () => {
      const styles = getComputedStyle(shell);
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const scale = Math.min(1, Math.max(0.1, (shell.clientWidth - padX) / A4_WIDTH));
      shell.style.height = `${A4_HEIGHT * scale + padY}px`;
      const frame = shell.querySelector(".records-frame");
      if (frame) frame.style.transform = `scale(${scale})`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [record?.pid, phonePreview]);

  const open = (id) => {
    onSelect(id);
    setPhonePreview(true);
  };

  const focusRow = (index) => {
    const rows = Array.from(listRef.current?.querySelectorAll(".record-row") ?? []);
    if (!rows.length) return;
    rows[(index + rows.length) % rows.length]?.focus();
  };

  const rowKeyDown = (event, index, id) => {
    if (event.key === "ArrowDown") { event.preventDefault(); focusRow(index + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); focusRow(index - 1); }
    if (event.key === "Home") { event.preventDefault(); focusRow(0); }
    if (event.key === "End") { event.preventDefault(); focusRow(records.length - 1); }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(id); }
  };

  // Group by visit date, keeping the server's newest-first order.
  const groups = [];
  for (const r of records) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.items.push(r);
    else groups.push({ date: r.date, items: [r] });
  }
  const filtered = query.trim() || filter !== "all" || dateFrom || dateTo;
  // Exactly one row is in the Tab order: the selected one, else the first.
  const tabbableId = records.some((r) => r.pid === selectedId) ? selectedId : records[0]?.pid;

  let content;
  if (status === "loading" && !records.length) {
    content = (
      <div className="records-list" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => <div className="record-skeleton" key={i} />)}
      </div>
    );
  } else if (status === "error") {
    content = (
      <div className="records-empty" role="alert">
        Couldn't load past prescriptions.
        <button type="button" className="records-button" onClick={onRetry}>Try again</button>
      </div>
    );
  } else if (!records.length) {
    content = (
      <div className="records-empty">
        {filtered
          ? query.trim()
            ? `No matches for "${query.trim()}". Try a different spelling or date.`
            : "No prescriptions in these dates."
          : "No prescriptions saved yet."}
      </div>
    );
  } else {
    content = (
      <div className="records-list" ref={listRef}>
        {groups.map((g) => (
          <section key={g.date}>
            <h3 className="record-date-heading">{formatDate(g.date) || "No date"}</h3>
            {g.items.map((r) => (
              <button
                type="button"
                key={r.pid}
                className={`record-row ${r.pid === selectedId ? "is-selected" : ""}`}
                tabIndex={r.pid === tabbableId ? 0 : -1}
                aria-current={r.pid === selectedId ? "true" : undefined}
                onKeyDown={(e) => rowKeyDown(e, records.indexOf(r), r.pid)}
                onClick={() => open(r.pid)}
              >
                <strong>{r.patient_name}</strong>
                <span className="record-meta">
                  {[r.age, r.gender].filter(Boolean).join(" · ")}
                </span>
                <span className="record-diagnosis">{r.diagnosis}</span>
                <code>{r.pid}</code>
              </button>
            ))}
          </section>
        ))}
        {hasMore && (
          <button type="button" className="records-button show-more" onClick={onLoadMore} disabled={status === "loading"}>
            {status === "loading" ? "Loading…" : "Show more"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="records-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`records-dialog ${phonePreview ? "is-phone-preview" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="records-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="records-list-pane">
          <header className="records-header">
            <h2 id="records-title">Past prescriptions</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <label className="records-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search by patient name or Reference ID</span>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by name or Reference ID"
              type="search"
              autoComplete="off"
            />
          </label>
          <div className="record-filters" role="group" aria-label="Date filters">
            {FILTERS.map((f) => (
              <button
                type="button"
                key={f.value}
                className={filter === f.value ? "is-active" : ""}
                aria-pressed={filter === f.value}
                onClick={() => onFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="date-range">
            <CalendarDays size={16} aria-hidden="true" />
            <label>
              <span>From</span>
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => onDateRange(e.target.value, dateTo)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => onDateRange(dateFrom, e.target.value)} />
            </label>
          </div>
          <div className="records-content">
            {/* Only the count is announced, never the whole list. */}
            <span className="sr-only" aria-live="polite">
              {status === "ready" ? `${total ?? records.length} records` : ""}
            </span>
            {content}
          </div>
        </div>

        <div className="records-preview-pane">
          <header className="preview-header">
            <button type="button" className="back-records" onClick={() => setPhonePreview(false)}>
              <ArrowLeft size={18} aria-hidden="true" />
              Back to list
            </button>
            {record && (
              <button type="button" className="records-button primary print-record" onClick={() => onPrint(record)}>
                <Printer size={16} aria-hidden="true" />
                Print
              </button>
            )}
            <button type="button" className="records-button close-preview" onClick={onClose}>
              Close
            </button>
          </header>
          {notice && (
            <p className="records-notice" role="alert">
              {notice}
            </p>
          )}
          {record ? (
            <div className="records-frame-wrap">
              <div className="records-frame-shell" ref={frameShellRef}>
                <iframe
                  title={`Prescription for ${record.patient_name}`}
                  className="records-frame"
                  srcDoc={buildPrintHtml(record, record.pid, { toolbar: false })}
                />
              </div>
            </div>
          ) : (
            <div className="preview-empty" role={preview?.status === "error" ? "alert" : undefined}>
              {preview?.status === "loading"
                ? "Loading…"
                : preview?.status === "error"
                ? "Couldn't load this prescription. Pick it again to retry."
                : "Pick a prescription to see it here."}
            </div>
          )}
          {/* Phones only (CSS): the header Print is hidden there, so this one
              is the ONLY print button on a phone — never both, never neither. */}
          {record && (
            <button type="button" className="records-button primary phone-print" onClick={() => onPrint(record)}>
              <Printer size={17} aria-hidden="true" />
              Print this prescription
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
