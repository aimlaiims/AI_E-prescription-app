import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RecordsBrowser from "./RecordsBrowser.jsx";
import { listForms, getForm } from "../api.js";
import { buildPrintHtml } from "../printTemplate.js";
import { dateBounds } from "../dates.js";
import { POPUP_BLOCKED_MESSAGE } from "../messages.js";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

// Owns the server side of "View past prescriptions": search (debounced),
// date filters, paging, loading the full record for the preview, printing.
export default function RecordsDialog({ onClose, letterhead }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [list, setList] = useState({ status: "loading", items: [], total: 0, hasMore: false });
  const [selectedId, setSelectedId] = useState();
  const [preview, setPreview] = useState({ status: "idle" });
  const [notice, setNotice] = useState("");
  // Only the newest request may update state (typing fires several).
  const listRequest = useRef(0);
  const previewRequest = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const params = useMemo(
    () => ({ q: debouncedQuery, ...dateBounds(filter, range.from, range.to) }),
    [debouncedQuery, filter, range]
  );

  const load = useCallback(
    async (offset) => {
      const id = ++listRequest.current;
      setList((s) => ({ ...s, status: "loading" }));
      try {
        const res = await listForms({ ...params, limit: PAGE_SIZE, offset });
        if (id !== listRequest.current) return;
        setList((s) => ({
          status: "ready",
          items: offset ? [...s.items, ...res.items] : res.items,
          total: res.total,
          hasMore: res.has_more,
        }));
      } catch {
        if (id === listRequest.current) setList((s) => ({ ...s, status: "error" }));
      }
    },
    [params]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const select = async (pid) => {
    setSelectedId(pid);
    setNotice("");
    const id = ++previewRequest.current;
    setPreview({ status: "loading" });
    try {
      const record = await getForm(pid);
      if (id === previewRequest.current) setPreview({ status: "ready", record });
    } catch {
      if (id === previewRequest.current) setPreview({ status: "error" });
    }
  };

  // Synchronous from the click (no await before window.open), or pop-up
  // blockers stop it. The record is already loaded for the preview.
  const print = (record) => {
    const win = window.open("", "_blank");
    if (!win) {
      setNotice(POPUP_BLOCKED_MESSAGE);
      return;
    }
    win.document.open();
    win.document.write(buildPrintHtml(record, record.pid, { letterhead }));
    win.document.close();
  };

  return (
    <RecordsBrowser
      status={list.status}
      records={list.items}
      total={list.total}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      dateFrom={range.from}
      dateTo={range.to}
      onDateRange={(from, to) => setRange({ from, to })}
      selectedId={selectedId}
      onSelect={select}
      preview={preview}
      notice={notice}
      onPrint={print}
      letterhead={letterhead}
      onClose={onClose}
      onRetry={() => load(0)}
      onLoadMore={() => load(list.items.length)}
      hasMore={list.hasMore}
    />
  );
}
