import { History, LogOut, Users } from "lucide-react";
import { BRAND } from "../branding.js";
import { doctorCredentials, doctorDisplayName } from "../doctor.js";
import { formatDate } from "../printTemplate.js";
import { localToday } from "../dates.js";

// Top bar: logo, product name, today's date, History (past prescriptions),
// Accounts (administrators only), the signed-in doctor and Sign out.
export function AppNavbar({ onHistory, onAccounts, doctorName, onSignOut }) {
  return (
    <header className="app-navbar">
      <div className="navbar-brand">
        <img src={BRAND.logoUrl} alt="" className="navbar-logo" width="32" height="32" />
        <div className="navbar-title">
          <span className="navbar-name">{BRAND.appName}</span>
          <span className="navbar-date">{formatDate(localToday())}</span>
        </div>
      </div>
      <div className="navbar-actions">
        <button
          type="button"
          className="navbar-button"
          onClick={onHistory}
          aria-haspopup="dialog"
          title="View past prescriptions"
        >
          <History size={15} aria-hidden="true" />
          History
        </button>
        {onAccounts && (
          <button
            type="button"
            className="navbar-button"
            onClick={onAccounts}
            aria-haspopup="dialog"
            title="Add and manage the department's accounts"
          >
            <Users size={15} aria-hidden="true" />
            Accounts
          </button>
        )}
        {doctorName && <span className="navbar-doctor">{doctorName}</span>}
        {onSignOut && (
          <button type="button" className="navbar-button" onClick={onSignOut} title="Sign out">
            <LogOut size={15} aria-hidden="true" />
            <span className="navbar-signout-label">Sign out</span>
          </button>
        )}
      </div>
    </header>
  );
}

// The navy letterhead band at the top of the sheet, like a printed pad:
// the doctor's name, qualification · specialization, the department, the
// institution (from the server's settings) and registration no.
export function SheetLetterhead({ profile }) {
  const doctor = profile?.doctor;
  const institution = profile?.institution || BRAND.institution;
  const name = doctorDisplayName(doctor?.full_name);
  const credentials = doctorCredentials(doctor);
  return (
    <header className="sheet-letterhead">
      <div className="letterhead-logo">
        <img src={BRAND.logoUrl} alt={`${institution} logo`} width="56" height="56" />
      </div>
      <div className="letterhead-text">
        <h1>{name || "E-Prescription"}</h1>
        {credentials && <p className="letterhead-credentials">{credentials}</p>}
        <p className="letterhead-institution">
          {profile?.department?.name ? `${profile.department.name} · ` : ""}
          {institution}
          {doctor?.registration_no ? ` · Reg. No. ${doctor.registration_no}` : ""}
        </p>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <img src={BRAND.logoUrl} alt="" width="16" height="16" />
      <span>{BRAND.footer}</span>
    </footer>
  );
}
