import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, KeyRound, Pencil, Power, UserPlus, X } from "lucide-react";
import {
  activateAccount,
  addAccount,
  deactivateAccount,
  editAccount,
  listAccounts,
  sendPasswordLink,
} from "../api.js";
import { doctorCredentials, doctorDisplayName } from "../doctor.js";
import { authErrorMessage } from "../messages.js";

// The department administrator's accounts screen (navbar → Accounts):
// add a doctor (they get a set-password link), edit details, deactivate /
// reactivate, send a password link. Server side: backend/app/routers/admin.py.
// Prescriptions are never shown here.

const EMPTY = {
  full_name: "", email: "", qualification: "", specialization: "", registration_no: "", role: "doctor",
};

const FIELDS = [
  ["full_name", "Full name", { required: true, autoComplete: "off", hint: 'As printed, e.g. "Anika Rao" ("Dr." is added).' }],
  ["email", "Email", { required: true, type: "email", autoComplete: "off", hint: "They sign in with this; links are sent here." }],
  ["qualification", "Qualification", { hint: "e.g. MBBS, MS (ENT)" }],
  ["specialization", "Specialization", {}],
  ["registration_no", "Registration no.", { hint: "Medical council registration, printed on prescriptions." }],
];

export default function AccountsDialog({ onClose, currentEmail, departmentName }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [accounts, setAccounts] = useState({ status: "loading", items: [] });
  // null | { mode: "add" } | { mode: "edit", id }
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What just happened, e.g. a link that was emailed or must be passed on.
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await listAccounts();
      setAccounts({ status: "ready", items: res.items });
    } catch {
      setAccounts((s) => ({ ...s, status: "error" }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Open/close lifecycle, as in the records dialog: focus in, scroll lock,
  // Esc (closes the open form first), Tab trapped, focus returned on close.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (editingRef.current) setEditing(null);
        else onCloseRef.current();
        return;
      }
      if (event.key === "Tab" && dialog) {
        const focusable = Array.from(
          dialog.querySelectorAll("button, input, select, [tabindex]:not([tabindex='-1'])")
        ).filter((el) => !el.hasAttribute("disabled") && (el.checkVisibility?.() ?? true));
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

  const startAdd = () => {
    setForm(EMPTY);
    setError("");
    setNotice(null);
    setEditing({ mode: "add" });
  };

  const startEdit = (a) => {
    setForm({
      full_name: a.full_name, email: a.email, qualification: a.qualification,
      specialization: a.specialization, registration_no: a.registration_no, role: a.role,
    });
    setError("");
    setNotice(null);
    setEditing({ mode: "edit", id: a.id });
  };

  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (err) {
      setError(authErrorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const linkNotice = (res) => ({
    name: doctorDisplayName(res.doctor.full_name),
    email: res.doctor.email,
    emailed: res.emailed,
    link: res.link,
    validFor: res.valid_for,
    newAccount: !res.doctor.password_set,
  });

  const save = async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
    const res = await run(() =>
      editing.mode === "add" ? addAccount(fields) : editAccount(editing.id, fields)
    );
    if (!res) return;
    setEditing(null);
    setNotice(editing.mode === "add" ? linkNotice(res) : { text: `${doctorDisplayName(res.doctor.full_name)}: details saved.` });
    load();
  };

  const toggleActive = async (a) => {
    if (a.is_active) {
      const ok = window.confirm(
        `Deactivate ${doctorDisplayName(a.full_name)}? They will be signed out and can't sign in until reactivated. Their prescriptions are kept.`
      );
      if (!ok) return;
    }
    const res = await run(() => (a.is_active ? deactivateAccount(a.id) : activateAccount(a.id)));
    if (!res) return;
    setNotice({ text: `${doctorDisplayName(a.full_name)} ${a.is_active ? "deactivated" : "reactivated"}.` });
    load();
  };

  const passwordLink = async (a) => {
    const res = await run(() => sendPasswordLink(a.id));
    if (res) setNotice(linkNotice(res));
  };

  return (
    <div className="records-backdrop">
      <div
        className="accounts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="records-header">
          <div>
            <h2 id="accounts-title">Accounts</h2>
            {departmentName && <p className="accounts-subtitle">{departmentName}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close accounts">
            <X size={20} />
          </button>
        </header>

        <div className="accounts-body">
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {notice && <Notice notice={notice} />}

          {editing ? (
            <form className="accounts-form" onSubmit={save} noValidate>
              <h3>{editing.mode === "add" ? "Add a doctor" : "Edit account"}</h3>
              {FIELDS.map(([key, label, { hint, required, ...input }]) => (
                <div className="auth-field" key={key}>
                  <label htmlFor={`account-${key}`}>
                    {label}
                    {!required && <span className="auth-optional"> (optional)</span>}
                  </label>
                  <input
                    id={`account-${key}`}
                    className="accounts-input"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    required={required}
                    autoCapitalize={key === "email" ? "none" : undefined}
                    spellCheck={key === "email" ? "false" : undefined}
                    {...input}
                  />
                  {hint && <p className="auth-hint">{hint}</p>}
                </div>
              ))}
              <div className="auth-field">
                <label htmlFor="account-role">Role</label>
                <select
                  id="account-role"
                  className="accounts-input"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="doctor">Doctor</option>
                  <option value="admin">Administrator (manages accounts, also writes prescriptions)</option>
                </select>
              </div>
              <div className="accounts-form-actions">
                <button type="button" className="records-button" onClick={() => setEditing(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="records-button primary" disabled={busy}>
                  {busy ? "Saving…" : editing.mode === "add" ? "Add and send link" : "Save"}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="records-button primary accounts-add" onClick={startAdd}>
              <UserPlus size={16} aria-hidden="true" />
              Add a doctor
            </button>
          )}

          {accounts.status === "error" && (
            <p className="records-empty">
              Couldn't load the accounts.{" "}
              <button type="button" className="auth-link" onClick={load}>
                Try again
              </button>
            </p>
          )}
          {accounts.status === "loading" && !accounts.items.length && <p className="records-empty">Loading…</p>}

          <ul className="accounts-list">
            {accounts.items.map((a) => {
              const me = a.email === currentEmail;
              const credentials = doctorCredentials(a);
              return (
                <li key={a.id} className={`account-card${a.is_active ? "" : " is-inactive"}`}>
                  <div className="account-main">
                    <p className="account-name">
                      {doctorDisplayName(a.full_name)}
                      {me && <span className="account-you"> (you)</span>}
                    </p>
                    <p className="account-email">{a.email}</p>
                    {(credentials || a.registration_no) && (
                      <p className="account-meta">
                        {[credentials, a.registration_no && `Reg. No. ${a.registration_no}`].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="account-badges">
                      {a.role === "admin" && <span className="account-badge">Administrator</span>}
                      {!a.is_active && <span className="account-badge is-warning">Deactivated</span>}
                      {a.is_active && !a.password_set && (
                        <span className="account-badge is-pending">Password not set yet</span>
                      )}
                    </p>
                  </div>
                  <div className="account-actions">
                    <button type="button" className="records-button" onClick={() => startEdit(a)} disabled={busy}>
                      <Pencil size={15} aria-hidden="true" />
                      Edit
                    </button>
                    {a.is_active && (
                      <button type="button" className="records-button" onClick={() => passwordLink(a)} disabled={busy}>
                        <KeyRound size={15} aria-hidden="true" />
                        {a.password_set ? "Send reset link" : "Send set-password link"}
                      </button>
                    )}
                    {!me && (
                      <button type="button" className="records-button" onClick={() => toggleActive(a)} disabled={busy}>
                        <Power size={15} aria-hidden="true" />
                        {a.is_active ? "Deactivate" : "Reactivate"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Notice({ notice }) {
  const [copied, setCopied] = useState(false);
  if (notice.text) {
    return (
      <p className="auth-success" role="status">
        {notice.text}
      </p>
    );
  }
  const what = notice.newAccount ? "set-password link" : "password reset link";
  if (notice.emailed) {
    return (
      <p className="auth-success" role="status">
        A {what} was emailed to {notice.name} ({notice.email}). It works for {notice.validFor}.
      </p>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notice.link);
      setCopied(true);
    } catch {
      /* clipboard blocked: the link stays selectable in the box */
    }
  };
  return (
    <div className="accounts-link" role="status">
      <p>
        Email isn't set up, so give this {what} to {notice.name} yourself. It works for {notice.validFor} and
        only once. Treat it like a password.
      </p>
      <div className="accounts-link-row">
        <input className="accounts-input" readOnly value={notice.link} aria-label={`${what} for ${notice.name}`} onFocus={(e) => e.target.select()} />
        <button type="button" className="records-button" onClick={copy}>
          <Copy size={15} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
