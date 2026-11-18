import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, UserPlus, X } from "lucide-react";
import { findPatients, getPatientHistory } from "../api.js";
import { formatDate } from "../printTemplate.js";
import { FIELD_SPECS } from "../fieldSpecs.js";
import { doctorDisplayName } from "../doctor.js";
import { useDialog } from "../useDialog.js";
import DiagramPad from "./DiagramPad.jsx";
import { DiagramThumbs } from "./ExamDiagrams.jsx";
import VisitReports from "./VisitReports.jsx";

// Patients shared by the department (backend: routers/patients.py):
//   FindPatientDialog  — search by name, Patient ID, OPD No. or city; pick one.
//   SamePatientDialog  — asked when a save looks like an already-registered
//                        patient: the same person, or a new patient?
//   PatientHistoryDialog — every visit of a patient, newest first.

const SEARCH_DEBOUNCE_MS = 250;

export function Shell({ titleId, title, subtitle, onClose, closeLabel, children, className = "" }) {
  const ref = useDialog(onClose);
  return (
    <div className="records-backdrop">
      <div className={`patient-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <header className="records-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="accounts-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>
            <X size={20} />
          </button>
        </header>
        <div className="patient-dialog-body">{children}</div>
      </div>
    </div>
  );
}

// One patient, as a summary: ID, name, details, last visit.
export function PatientSummary({ patient }) {
  const details = [patient.gender, patient.city, patient.occupation].filter(Boolean).join(" · ");
  const last = patient.last_visit;
  return (
    <div className="patient-summary">
      <p className="patient-summary-name">
        <strong>{patient.full_name}</strong> <code>{patient.label}</code>
      </p>
      {details && <p className="patient-summary-meta">{details}</p>}
      {patient.opd_no && (
        <p className="patient-summary-meta">
          {FIELD_SPECS.opd_no.label} {patient.opd_no}
        </p>
      )}
      <p className="patient-summary-meta">
        {last
          ? `${patient.visit_count} visit${patient.visit_count === 1 ? "" : "s"} · last ${formatDate(last.date)}${
              last.age ? `, age ${last.age}` : ""
            }${last.diagnosis ? ` · ${last.diagnosis}` : ""}`
          : "No visits yet"}
      </p>
    </div>
  );
}

export function FindPatientDialog({ onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState({ status: "loading", items: [] });
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    const t = setTimeout(async () => {
      setList((s) => ({ ...s, status: "loading" }));
      try {
        const res = await findPatients(query);
        if (id === request.current) setList({ status: "ready", items: res.items });
      } catch {
        if (id === request.current) setList((s) => ({ ...s, status: "error" }));
      }
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <Shell titleId="find-patient-title" title="Find patient" subtitle="Patients of your department" onClose={onClose} closeLabel="Close find patient">
      <label className="records-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search patients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Name, Patient ID, ${FIELD_SPECS.opd_no.label} or city`}
          autoFocus
          enterKeyHint="search"
        />
      </label>
      {list.status === "error" && <p className="records-empty">Couldn't search patients. Check the connection and try again.</p>}
      {list.status === "ready" && !list.items.length && (
        <p className="records-empty">
          {query ? "No patient matches." : "No patients yet."} A new patient is registered when you save
          their first prescription.
        </p>
      )}
      <ul className="patient-list">
        {list.items.map((p) => (
          <li key={p.id} className="patient-card">
            <PatientSummary patient={p} />
            <button type="button" className="records-button primary" onClick={() => onPick(p)}>
              Use this patient
            </button>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

// `candidates`: the server's possible duplicates. onChoose({ patientId }) or
// onChoose({ newPatient: true }) — called from the click itself, so printing
// can open its window synchronously.
export function SamePatientDialog({ candidates, patientName, onChoose, onClose }) {
  return (
    <Shell
      titleId="same-patient-title"
      title="Is this the same patient?"
      subtitle={`${patientName || "This patient"} may already be registered. Choose them to keep the history together.`}
      onClose={onClose}
      closeLabel="Cancel, don't save yet"
    >
      <ul className="patient-list">
        {candidates.map((p) => (
          <li key={p.id} className="patient-card">
            <PatientSummary patient={p} />
            <button type="button" className="records-button primary" onClick={() => onChoose({ patientId: p.id })}>
              Same patient
            </button>
          </li>
        ))}
      </ul>
      <div className="patient-dialog-actions">
        <button type="button" className="records-button" onClick={() => onChoose({ newPatient: true })}>
          <UserPlus size={16} aria-hidden="true" />
          No, register a new patient
        </button>
        <button type="button" className="records-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

const VISIT_SECTIONS = ["chief_complaints", "on_examination", "diagnosis", "investigation", "medications", "advice"];

export function PatientHistoryDialog({ patientId, onClose }) {
  const [data, setData] = useState({ status: "loading" });
  const [open, setOpen] = useState(null);
  // { visit, start }: a visit's diagrams, full screen.
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    let live = true;
    getPatientHistory(patientId)
      .then((res) => {
        if (!live) return;
        setData({ status: "ready", ...res });
        setOpen(res.visits[0]?.pid ?? null);
      })
      .catch(() => live && setData({ status: "error" }));
    return () => {
      live = false;
    };
  }, [patientId]);

  const patient = data.patient;
  return (
    <Shell
      titleId="history-title"
      title={patient ? `${patient.full_name}` : "Patient history"}
      subtitle={patient ? `${patient.label} · ${patient.visit_count} visit${patient.visit_count === 1 ? "" : "s"}` : ""}
      onClose={onClose}
      closeLabel="Close patient history"
      className="is-history"
    >
      {data.status === "loading" && <p className="records-empty">Loading…</p>}
      {data.status === "error" && <p className="records-empty">Couldn't load the history. Check the connection and try again.</p>}
      {patient && (
        <p className="patient-summary-meta">
          {[patient.gender, patient.city, patient.occupation, patient.opd_no && `${FIELD_SPECS.opd_no.label} ${patient.opd_no}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <ol className="visit-list">
        {(data.visits || []).map((v) => {
          const expanded = open === v.pid;
          return (
            <li key={v.pid} className={`visit-card${expanded ? " is-open" : ""}`}>
              <button
                type="button"
                className="visit-toggle"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : v.pid)}
              >
                <span className="visit-date">{formatDate(v.date) || "No date"}</span>
                <span className="visit-diagnosis">{v.diagnosis}</span>
                <span className="visit-meta">
                  {doctorDisplayName(v.doctor_name)}
                  {v.age ? ` · age ${v.age}` : ""}
                </span>
                <ChevronDown size={18} aria-hidden="true" className="visit-chevron" />
              </button>
              {expanded && (
                <div className="visit-details">
                  {VISIT_SECTIONS.filter((k) => String(v[k] || "").trim()).map((k) => (
                    <section key={k}>
                      <h3>{FIELD_SPECS[k].label}</h3>
                      <p>{v[k]}</p>
                    </section>
                  ))}
                  {v.drawings?.length > 0 && (
                    <section>
                      <h3>Diagrams</h3>
                      <DiagramThumbs items={v.drawings} onOpen={(start) => setViewing({ visit: v, start })} />
                    </section>
                  )}
                  <section>
                    <h3>Reports</h3>
                    <VisitReports
                      pid={v.pid}
                      reports={v.reports || []}
                      onChange={(next) =>
                        setData((d) => ({ ...d, visits: d.visits.map((x) => (x.pid === v.pid ? { ...x, reports: next } : x)) }))
                      }
                    />
                  </section>
                  <p className="visit-ref">
                    Reference ID <code>{v.pid}</code>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {viewing && (
        <DiagramPad
          readOnly
          title={`Diagrams · ${formatDate(viewing.visit.date) || "No date"}`}
          keys={viewing.visit.drawings.map((d) => d.diagram)}
          start={viewing.start}
          drawings={Object.fromEntries(viewing.visit.drawings.map((d) => [d.diagram, d.strokes]))}
          versions={Object.fromEntries(viewing.visit.drawings.map((d) => [d.diagram, d.version]))}
          onClose={() => setViewing(null)}
        />
      )}
    </Shell>
  );
}
