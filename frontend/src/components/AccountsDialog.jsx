import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Copy, KeyRound, Pencil, Power, Ticket, X } from "lucide-react";
import {
  activateAccount,
  approveAccount,
  createCode,
  deactivateAccount,
  editAccount,
  listAccounts,
  listCodes,
  listDepartments,
  rejectAccount,
  revokeCode,
  sendPasswordLink,
} from "../api.js";
import { doctorCredentials, doctorDisplayName } from "../doctor.js";
import { formatDate } from "../printTemplate.js";
import { authErrorMessage } from "../messages.js";
import { useDialog } from "../useDialog.js";

// The administrator's accounts screen (navbar → Accounts), for every
// department: registration codes for new doctors, approving registrations,
// correcting details, deactivating, password links. Server side:
// backend/app/routers/admin.py. Prescriptions are never shown here, and
// nothing here makes anyone an administrator.

const FIELDS = [
  ["full_name", "Full name", { required: true, hint: 'As printed, e.g. "Meera Iyer" ("Dr." is added).' }],
  ["email", "Email", { required: true, type: "email", hint: "They sign in with this; links are sent here." }],
  ["designation", "Designation", { hint: "e.g. Senior Resident" }],
  ["qualification", "Qualification", { hint: "e.g. MBBS, MS (ENT)" }],
  ["specialization", "Specialization", {}],
  ["registration_no", "Registration no.", { hint: "Medical council registration, printed on prescriptions." }],
];
const STATUS = {
  open: ["Open", ""],
  used: ["Used", "is-done"],
  expired: ["Expired", "is-muted"],
  revoked: ["Revoked", "is-muted"],
};
const dateOf = (iso) => (iso ? formatDate(iso.slice(0, 10)) : "");

export default function AccountsDialog({ onClose, currentEmail }) {
  const [accounts, setAccounts] = useState({ status: "loading", items: [] });
  const [codes, setCodes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [codeForm, setCodeForm] = useState({ department_id: "", note: "" });
  const [newCode, setNewCode] = useState(null); // the code just created (shown once)
  const [editing, setEditing] = useState(null); // account id being edited
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const ref = useDialog(() => (editing ? setEditing(null) : onClose()));

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([listAccounts(), listCodes()]);
      setAccounts({ status: "ready", items: a.items });
      setCodes(c.items);
    } catch {
      setAccounts((s) => ({ ...s, status: "error" }));
    }
  }, []);

  useEffect(() => {
    load();
    listDepartments()
      .then((d) => {
        setDepartments(d.items);
        const ent = d.items.find((x) => x.code === "ENT") || d.items[0];
        if (ent) setCodeForm((f) => ({ ...f, department_id: String(ent.id) }));
      })
      .catch(() => {});
  }, [load]);

  const run = async (action, after) => {
    setBusy(true);
    setError("");
    try {
      const res = await action();
      after?.(res);
      load();
      return res;
    } catch (err) {
      setError(authErrorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const makeCode = (e) => {
    e.preventDefault();
    setNotice(null);
    run(
      () => createCode({ department_id: Number(codeForm.department_id) || null, note: codeForm.note.trim() }),
      (res) => {
        setNewCode(res);
        setCodeForm((f) => ({ ...f, note: "" }));
      }
    );
  };

  const startEdit = (a) => {
    setForm(Object.fromEntries(FIELDS.map(([k]) => [k, a[k] || ""])));
    setError("");
    setNotice(null);
    setEditing(a.id);
  };

  const saveEdit = (e) => {
    e.preventDefault();
    run(
      () => editAccount(editing, Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))),
      (res) => {
        setEditing(null);
        setNotice({ text: `${doctorDisplayName(res.doctor.full_name)}: details saved.` });
      }
    );
  };

  const toggleActive = (a) => {
    if (a.is_active && !window.confirm(
      `Deactivate ${doctorDisplayName(a.full_name)}? They will be signed out and can't sign in until reactivated. Their prescriptions are kept.`
    )) return;
    run(
      () => (a.is_active ? deactivateAccount(a.id) : activateAccount(a.id)),
      () => setNotice({ text: `${doctorDisplayName(a.full_name)} ${a.is_active ? "deactivated" : "reactivated"}.` })
    );
  };

  const approve = (a) =>
    run(() => approveAccount(a.id), () => setNotice({ text: `${doctorDisplayName(a.full_name)} approved. They can sign in now.` }));
  const reject = (a) => {
    if (!window.confirm(`Reject the registration of ${doctorDisplayName(a.full_name)} (${a.email})? They won't be able to sign in.`)) return;
    run(() => rejectAccount(a.id), () => setNotice({ text: `Registration of ${doctorDisplayName(a.full_name)} rejected.` }));
  };

  const passwordLink = (a) =>
    run(() => sendPasswordLink(a.id), (res) =>
      setNotice({ name: doctorDisplayName(res.doctor.full_name), email: res.doctor.email, emailed: res.emailed,
                  link: res.link, validFor: res.valid_for }));

  const pending = accounts.items.filter((a) => !a.approved && a.is_active);
  const others = accounts.items.filter((a) => a.approved || !a.is_active);
  const manyDepartments = departments.length > 1;

  return (
    <div className="records-backdrop">
      <div className="accounts-dialog" role="dialog" aria-modal="true" aria-labelledby="accounts-title" tabIndex={-1} ref={ref}>
        <header className="records-header">
          <div>
            <h2 id="accounts-title">Accounts</h2>
            <p className="accounts-subtitle">Registration codes, approvals and accounts{manyDepartments ? " for all departments" : ""}</p>
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

          {pending.length > 0 && (
            <section className="accounts-section" aria-labelledby="pending-title">
              <h3 id="pending-title">Waiting for approval</h3>
              <ul className="accounts-list">
                {pending.map((a) => (
                  <li key={a.id} className="account-card is-pending">
                    <AccountMain a={a} showDepartment={manyDepartments} />
                    <div className="account-actions">
                      <button type="button" className="records-button primary" onClick={() => approve(a)} disabled={busy}>
                        <Check size={15} aria-hidden="true" />
                        Approve
                      </button>
                      <button type="button" className="records-button" onClick={() => reject(a)} disabled={busy}>
                        <Ban size={15} aria-hidden="true" />
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="accounts-section" aria-labelledby="codes-title">
            <h3 id="codes-title">Registration codes</h3>
            <p className="accounts-help">
              One code per new doctor. They tap <strong>Register with a code</strong> on the sign-in screen and fill in their
              own details; you approve them here.
            </p>
            {newCode && (
              <NewCode code={newCode} />
            )}
            <form className="accounts-code-form" onSubmit={makeCode} noValidate>
              {manyDepartments && (
                <div className="auth-field">
                  <label htmlFor="code-department">Department</label>
                  <select
                    id="code-department"
                    className="accounts-input"
                    value={codeForm.department_id}
                    onChange={(e) => setCodeForm((f) => ({ ...f, department_id: e.target.value }))}
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="auth-field">
                <label htmlFor="code-note">
                  Who is it for? <span className="auth-optional">(optional, only you see it)</span>
                </label>
                <input
                  id="code-note"
                  className="accounts-input"
                  value={codeForm.note}
                  onChange={(e) => setCodeForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="e.g. Dr Meera Iyer, SR"
                  autoComplete="off"
                />
              </div>
              <button type="submit" className="records-button primary" disabled={busy}>
                <Ticket size={16} aria-hidden="true" />
                Create registration code
              </button>
            </form>
            {codes.length > 0 && (
              <ul className="code-list">
                {codes.map((c) => {
                  const [label, cls] = STATUS[c.status] || [c.status, ""];
                  return (
                    <li key={c.id} className="code-row">
                      <div className="code-main">
                        <span className={`code-status ${cls}`}>{label}</span>
                        <span>{c.note || "No note"}</span>
                        <span className="account-meta">
                          {manyDepartments && c.department ? `${c.department.name} · ` : ""}
                          {c.status === "used" && c.used_by
                            ? `Used by ${doctorDisplayName(c.used_by.full_name)} (${c.used_by.email})`
                            : c.status === "open"
                            ? `Expires ${dateOf(c.expires_at)}`
                            : `Created ${dateOf(c.created_at)}`}
                        </span>
                      </div>
                      {c.status === "open" && (
                        <button type="button" className="records-button" onClick={() => run(() => revokeCode(c.id))} disabled={busy}>
                          <Ban size={15} aria-hidden="true" />
                          Revoke
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="accounts-section" aria-labelledby="doctors-title">
            <h3 id="doctors-title">Doctors</h3>
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
              {others.map((a) => {
                const me = a.email === currentEmail;
                if (editing === a.id) {
                  return (
                    <li key={a.id} className="account-card">
                      <form className="accounts-form" onSubmit={saveEdit} noValidate>
                        <h3>Edit {doctorDisplayName(a.full_name)}</h3>
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
                              autoCapitalize={key === "email" ? "none" : undefined}
                              spellCheck={key === "email" ? "false" : undefined}
                              {...input}
                            />
                            {hint && <p className="auth-hint">{hint}</p>}
                          </div>
                        ))}
                        <div className="accounts-form-actions">
                          <button type="button" className="records-button" onClick={() => setEditing(null)} disabled={busy}>
                            Cancel
                          </button>
                          <button type="submit" className="records-button primary" disabled={busy}>
                            {busy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </form>
                    </li>
                  );
                }
                return (
                  <li key={a.id} className={`account-card${a.is_active ? "" : " is-inactive"}`}>
                    <AccountMain a={a} me={me} showDepartment={manyDepartments} />
                    <div className="account-actions">
                      <button type="button" className="records-button" onClick={() => startEdit(a)} disabled={busy}>
                        <Pencil size={15} aria-hidden="true" />
                        Edit
                      </button>
                      {a.is_active && a.approved && (
                        <button type="button" className="records-button" onClick={() => passwordLink(a)} disabled={busy}>
                          <KeyRound size={15} aria-hidden="true" />
                          {a.password_set ? "Send reset link" : "Send set-password link"}
                        </button>
                      )}
                      {a.role !== "admin" && (
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
          </section>
        </div>
      </div>
    </div>
  );
}

function AccountMain({ a, me, showDepartment }) {
  const credentials = doctorCredentials(a);
  return (
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
        {showDepartment && a.department && <span className="account-badge is-plain">{a.department.name}</span>}
        {!a.approved && a.is_active && <span className="account-badge is-pending">Waiting for approval</span>}
        {!a.is_active && <span className="account-badge is-warning">{a.approved ? "Deactivated" : "Rejected"}</span>}
      </p>
    </div>
  );
}

function NewCode({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
    } catch {
      /* clipboard blocked: the code stays readable on screen */
    }
  };
  return (
    <div className="new-code" role="status">
      <p>
        Registration code{code.note ? ` for ${code.note}` : ""}{code.department ? ` (${code.department.name})` : ""}:
      </p>
      <div className="new-code-row">
        <code className="new-code-value">{code.code}</code>
        <button type="button" className="records-button" onClick={copy}>
          <Copy size={15} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="accounts-help">
        Works once, for {code.valid_hours} hours. Give it to the doctor (in person, by phone or message). It is shown only
        now.
      </p>
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
  if (notice.emailed) {
    return (
      <p className="auth-success" role="status">
        A password reset link was emailed to {notice.name} ({notice.email}). It works for {notice.validFor}.
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
        Email isn't set up, so give this password reset link to {notice.name} yourself. It works for {notice.validFor} and
        only once. Treat it like a password.
      </p>
      <div className="accounts-link-row">
        <input className="accounts-input" readOnly value={notice.link} aria-label={`Password reset link for ${notice.name}`} onFocus={(e) => e.target.select()} />
        <button type="button" className="records-button" onClick={copy}>
          <Copy size={15} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
