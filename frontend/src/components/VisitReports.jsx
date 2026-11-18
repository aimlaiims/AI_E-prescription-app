import { useEffect, useRef, useState } from "react";
import { Camera, Download, FileText, Image, Paperclip, Plus, Trash2, Video, X } from "lucide-react";
import { getReportTypes, removeReport, reportFileUrl, uploadReport } from "../api.js";
import { reportErrorMessage } from "../messages.js";
import { formatDate } from "../printTemplate.js";
import { doctorDisplayName } from "../doctor.js";

// Reports of one saved visit (backend services/reports.py): test reports,
// endoscopy videos, clinical photos. Added after saving, also to earlier
// visits from the patient's history; never printed. Anyone in the department
// may open them; only the person who added a file may remove it.
//
// `pid`: the visit; `reports`: its files as the server returned them;
// `onChange(next)`: the list after an upload or removal.

const OTHER = "__other";
const MB = 1024 * 1024;

export const REMOVE_REPORT_MESSAGE = "Remove this file from the visit? This can't be undone.";

let typesPromise = null;
function reportTypes() {
  typesPromise ??= getReportTypes().catch((err) => {
    typesPromise = null; // try again next time
    throw err;
  });
  return typesPromise;
}
export function forgetReportTypes() {
  typesPromise = null;
}

export function formatSize(bytes) {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

const KIND_ICON = { pdf: FileText, image: Image, video: Video };

export default function VisitReports({ pid, reports, onChange }) {
  const [types, setTypes] = useState(null);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("");
  const [test, setTest] = useState("");
  const [otherName, setOtherName] = useState("");
  const [uploads, setUploads] = useState([]); // { id, name, progress, error, abort }
  const [problem, setProblem] = useState("");
  const listRef = useRef(reports);
  listRef.current = reports;
  const nextId = useRef(1);

  useEffect(() => {
    let live = true;
    reportTypes()
      .then((t) => live && setTypes(t))
      .catch(() => live && setTypes({ categories: [], max_mb: 200, failed: true }));
    return () => {
      live = false;
    };
  }, []);

  const categories = types?.categories || [];
  const chosen = categories.find((c) => c.key === category);
  const testName = chosen?.tests.length ? (test === OTHER ? otherName.trim() : test) : "";
  const ready = !!chosen && (!chosen.tests.length || !!testName);
  const labelOf = (key) => categories.find((c) => c.key === key)?.label || key;

  const patch = (id, fields) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...fields } : u)));

  const send = (files) => {
    setProblem("");
    for (const file of files) {
      const id = nextId.current++;
      if (types && file.size > types.max_mb * MB) {
        setUploads((list) => [...list, { id, name: file.name, progress: 0,
          error: reportErrorMessage({ code: "too_large", detail: { max_mb: types.max_mb } }) }]);
        continue;
      }
      const { promise, abort } = uploadReport(pid, { category, test: testName, file }, (p) => patch(id, { progress: p }));
      setUploads((list) => [...list, { id, name: file.name, progress: 0, error: "", abort }]);
      promise
        .then((report) => {
          setUploads((list) => list.filter((u) => u.id !== id));
          onChange([...listRef.current, report]);
        })
        .catch((err) => patch(id, { error: reportErrorMessage(err), abort: null }));
    }
  };

  const pick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // the same file can be chosen again
    if (files.length) send(files);
  };

  const remove = async (report) => {
    if (!window.confirm(REMOVE_REPORT_MESSAGE)) return;
    setProblem("");
    try {
      await removeReport(report.id);
      onChange(listRef.current.filter((r) => r.id !== report.id));
    } catch (err) {
      setProblem(reportErrorMessage(err));
    }
  };

  // Grouped by category, in the department's order (unknown ones last).
  const order = (key) => {
    const i = categories.findIndex((c) => c.key === key);
    return i < 0 ? categories.length : i;
  };
  const sorted = [...reports].sort((a, b) => order(a.category) - order(b.category) || a.id - b.id);

  return (
    <div className="visit-reports">
      {sorted.length > 0 && (
        <ul className="report-list">
          {sorted.map((r) => {
            const Icon = KIND_ICON[r.kind] || Paperclip;
            return (
              <li key={r.id} className="report-item">
                <Icon size={20} aria-hidden="true" className="report-icon" />
                <div className="report-text">
                  <a href={reportFileUrl(r.id)} target="_blank" rel="noopener noreferrer" className="report-open">
                    {labelOf(r.category)}
                    {r.test ? ` · ${r.test}` : ""}
                  </a>
                  <span className="report-meta">
                    {r.file_name} · {formatSize(r.size)} · {formatDate(r.uploaded_at?.slice(0, 10))}
                    {r.uploaded_by ? ` · ${doctorDisplayName(r.uploaded_by)}` : ""}
                  </span>
                </div>
                <a className="icon-button" href={reportFileUrl(r.id, true)} aria-label={`Download ${r.file_name}`} title="Download">
                  <Download size={18} aria-hidden="true" />
                </a>
                {r.mine && (
                  <button type="button" className="icon-button" onClick={() => remove(r)} aria-label={`Remove ${r.file_name}`} title="Remove">
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {uploads.length > 0 && (
        <ul className="report-list">
          {uploads.map((u) => (
            <li key={u.id} className={`report-item is-uploading${u.error ? " has-error" : ""}`}>
              <Paperclip size={20} aria-hidden="true" className="report-icon" />
              <div className="report-text">
                <span className="report-name">{u.name}</span>
                {u.error ? (
                  <span className="report-error" role="alert">{u.error}</span>
                ) : (
                  <progress max="1" value={u.progress} aria-label={`Uploading ${u.name}`} />
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => (u.abort ? u.abort() : setUploads((list) => list.filter((x) => x.id !== u.id)))}
                aria-label={u.abort ? `Stop uploading ${u.name}` : `Dismiss ${u.name}`}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {problem && <p className="report-error" role="alert">{problem}</p>}

      {!adding ? (
        <button type="button" className="records-button" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          Add report
        </button>
      ) : types?.failed ? (
        <p className="report-error" role="alert">Couldn't load the list of reports. Check the connection and try again.</p>
      ) : (
        <div className="report-add" role="group" aria-label="Add report">
          <label className="report-field">
            <span>What is it?</span>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setTest(""); setOtherName(""); }}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>
          {chosen?.tests.length > 0 && (
            <label className="report-field">
              <span>Test</span>
              <select value={test} onChange={(e) => setTest(e.target.value)}>
                <option value="">Choose…</option>
                {chosen.tests.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value={OTHER}>Other…</option>
              </select>
            </label>
          )}
          {chosen?.tests.length > 0 && test === OTHER && (
            <label className="report-field">
              <span>Test name</span>
              <input type="text" value={otherName} maxLength={80} onChange={(e) => setOtherName(e.target.value)} />
            </label>
          )}
          <div className="report-add-actions">
            <label className={`records-button primary${ready ? "" : " is-disabled"}`}>
              <Paperclip size={16} aria-hidden="true" />
              Choose files
              <input type="file" className="sr-only" multiple disabled={!ready}
                accept="application/pdf,image/*,video/*" onChange={pick} />
            </label>
            <label className={`records-button${ready ? "" : " is-disabled"}`}>
              <Camera size={16} aria-hidden="true" />
              Camera
              <input type="file" className="sr-only" disabled={!ready}
                accept="image/*,video/*" capture="environment" onChange={pick} />
            </label>
            <button type="button" className="records-button" onClick={() => setAdding(false)}>
              Done
            </button>
          </div>
          <p className="report-hint">PDF, pictures or videos, up to {types?.max_mb ?? 200} MB each.</p>
        </div>
      )}
    </div>
  );
}
