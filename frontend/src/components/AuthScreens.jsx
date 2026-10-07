import { useState } from "react";
import { Eye, EyeOff, Lock, Mail, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { BRAND } from "../branding.js";
import { forgotPassword, login, resetPassword } from "../api.js";
import { authErrorMessage } from "../messages.js";

// Sign-in screens. Design from the colleague's app (brand panel + card);
// the logic is ours: accounts live on the server (see backend/app/routers/auth.py).

const FEATURES = [
  { icon: Mic, label: "Dictate the visit by voice" },
  { icon: Sparkles, label: "Review every detail before it's saved" },
  { icon: ShieldCheck, label: "Your prescriptions, only for you" },
];

export function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-brand-rx">℞</div>
        <div className="auth-brand-top">
          <span className="auth-logo">
            <img src={BRAND.logoUrl} alt="" width="40" height="40" />
          </span>
          <span className="auth-brand-name">{BRAND.appName}</span>
        </div>
        <div>
          <h1 className="auth-brand-title">AI voice prescriptions</h1>
          <p className="auth-brand-text">{BRAND.institution}. Dictate, review and issue prescriptions faster.</p>
          <ul className="auth-features">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label}>
                <span className="auth-feature-icon">
                  <Icon size={15} />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-brand-foot">Authorised medical staff only</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-brand">
            <span className="auth-logo">
              <img src={BRAND.logoUrl} alt="" width="36" height="36" />
            </span>
            <span>{BRAND.appName}</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Field({ icon: Icon, label, type = "text", value, onChange, autoComplete, required = true, hint, ...rest }) {
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const id = `auth-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>
        {label}
        {!required && <span className="auth-optional"> (optional)</span>}
      </label>
      <div className="auth-input-shell">
        <Icon size={16} className="auth-input-icon" aria-hidden="true" />
        <input
          id={id}
          type={isPassword && shown ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className="auth-reveal"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && (
        <p className="auth-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <p className="auth-error" role="alert">
      {message}
    </p>
  );
}

function SubmitButton({ busy, children, busyLabel }) {
  return (
    <button type="submit" className="auth-submit" disabled={busy}>
      {busy ? busyLabel : children}
    </button>
  );
}

// `lockedEmail`: re-sign-in after a session ended mid-prescription — only
// the same doctor may continue that form.
export function LoginForm({ onSignedIn, onForgot, lockedEmail, onSwitchUser, notice, titleId }) {
  const [email, setEmail] = useState(lockedEmail || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      onSignedIn(await login(email.trim(), password, remember));
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="auth-title" id={titleId}>
        Sign in
      </h2>
      <p className="auth-subtitle">{notice || "Sign in to write and print prescriptions."}</p>
      <form onSubmit={submit} className="auth-form" noValidate>
        <ErrorNote message={error} />
        <Field
          icon={Mail}
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          readOnly={!!lockedEmail}
          autoCapitalize="none"
          spellCheck="false"
        />
        <Field
          icon={Lock}
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus={!!lockedEmail}
        />
        <div className="auth-row">
          {!lockedEmail && (
            <label className="auth-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me signed in for 30 days
            </label>
          )}
          {onForgot && (
            <button type="button" className="auth-link" onClick={onForgot}>
              Forgot password?
            </button>
          )}
        </div>
        <SubmitButton busy={busy} busyLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
      {lockedEmail ? (
        <p className="auth-foot">
          Not you?{" "}
          <button type="button" className="auth-link" onClick={onSwitchUser}>
            Sign in as someone else
          </button>{" "}
          (the open prescription will be discarded).
        </p>
      ) : (
        <p className="auth-foot">No account yet? Your department's administrator adds it and sends you a link.</p>
      )}
    </>
  );
}

export function ForgotForm({ onLogin }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setBusy(true);
    try {
      setSent((await forgotPassword(email.trim())).message);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="auth-title">Reset your password</h2>
      <p className="auth-subtitle">We'll email you a link to choose a new one.</p>
      {sent ? (
        <p className="auth-success" role="status">
          {sent}
        </p>
      ) : (
        <form onSubmit={submit} className="auth-form" noValidate>
          <ErrorNote message={error} />
          <Field icon={Mail} label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <SubmitButton busy={busy} busyLabel="Sending…">
            Send reset link
          </SubmitButton>
        </form>
      )}
      <p className="auth-foot">
        <button type="button" className="auth-link" onClick={onLogin}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

// mode "reset" (forgot password / admin's reset link) or "setup" (a new
// account's first password, from the administrator's link).
export function ResetForm({ token, mode = "reset", onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      setDone((await resetPassword(token, password)).message);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="auth-title">{mode === "setup" ? "Set your password" : "Choose a new password"}</h2>
      {done ? (
        <>
          <p className="auth-success" role="status">
            {done}
          </p>
          <button type="button" className="auth-submit" onClick={onDone}>
            Go to sign in
          </button>
        </>
      ) : (
        <>
          <p className="auth-subtitle">At least 8 characters.</p>
          <form onSubmit={submit} className="auth-form" noValidate>
            <ErrorNote message={error} />
            <Field icon={Lock} label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
            <Field icon={Lock} label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <SubmitButton busy={busy} busyLabel="Saving…">
              Save new password
            </SubmitButton>
          </form>
          <p className="auth-foot">
            <button type="button" className="auth-link" onClick={onDone}>
              Back to sign in
            </button>
          </p>
        </>
      )}
    </>
  );
}
