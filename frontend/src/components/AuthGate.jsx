import { useEffect, useRef, useState } from "react";
import App from "../App.jsx";
import { AuthLayout, ForgotForm, LoginForm, RegisterForm, ResetForm } from "./AuthScreens.jsx";
import { UNAUTHENTICATED_EVENT, getMe, logout } from "../api.js";
import { SESSION_ENDED_MESSAGE } from "../messages.js";

// Root of the app: shows the sign-in screens until the server confirms a
// session (GET /api/auth/me), then the prescription app.
//
// If the session ends while a prescription is open (any request answers
// "unauthenticated"), a sign-in box opens ON TOP of the app — the form stays
// mounted, so nothing typed or dictated is lost. Only the same doctor can
// continue it; "sign in as someone else" discards it.
export default function AuthGate() {
  // A password link: ?reset=… (reset) or ?setup=… (new account, from the
  // administrator). Read once (a pure initializer: StrictMode runs it twice),
  // then removed from the address bar by the effect below — a single-use secret.
  const [link] = useState(readPasswordLink);
  const resetToken = link?.token;
  useEffect(() => {
    if (resetToken) clearPasswordLink();
  }, [resetToken]);
  const [status, setStatus] = useState(resetToken ? "signed-out" : "checking");
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState(resetToken ? "reset" : "login");
  const [sessionEnded, setSessionEnded] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (resetToken) return;
    getMe()
      .then((p) => {
        setProfile(p);
        setStatus("signed-in");
      })
      .catch(() => setStatus("signed-out"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onUnauthenticated = () => {
      if (statusRef.current === "signed-in") setSessionEnded(true);
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, []);

  const signedIn = (p) => {
    setProfile(p);
    setStatus("signed-in");
    setSessionEnded(false);
    setView("login");
  };

  const signOut = async () => {
    try {
      await logout();
    } catch {
      /* already signed out on the server, or offline: sign out here anyway */
    }
    setProfile(null);
    setSessionEnded(false);
    setStatus("signed-out");
    setView("login");
  };

  const toLogin = () => setView("login");

  if (status === "checking") {
    return (
      <div className="auth-loading" role="status">
        Loading…
      </div>
    );
  }

  if (status === "signed-out") {
    return (
      <AuthLayout>
        {view === "forgot" && <ForgotForm onLogin={toLogin} />}
        {view === "register" && <RegisterForm onLogin={toLogin} />}
        {view === "reset" && <ResetForm token={resetToken} mode={link.mode} onDone={toLogin} />}
        {view === "login" && (
          <LoginForm onSignedIn={signedIn} onForgot={() => setView("forgot")} onRegister={() => setView("register")} />
        )}
      </AuthLayout>
    );
  }

  return (
    <>
      <App profile={profile} onSignOut={signOut} />
      {sessionEnded && (
        <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
          <div className="auth-card auth-overlay-card">
            <LoginForm
              titleId="reauth-title"
              lockedEmail={profile?.doctor?.email}
              notice={SESSION_ENDED_MESSAGE}
              onSignedIn={signedIn}
              onSwitchUser={signOut}
            />
          </div>
        </div>
      )}
    </>
  );
}

function readPasswordLink() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup")) return { token: params.get("setup"), mode: "setup" };
  if (params.get("reset")) return { token: params.get("reset"), mode: "reset" };
  return null;
}

// The token is single-use; keep it out of the address bar and history.
function clearPasswordLink() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("reset") || url.searchParams.has("setup")) {
    url.searchParams.delete("reset");
    url.searchParams.delete("setup");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}
