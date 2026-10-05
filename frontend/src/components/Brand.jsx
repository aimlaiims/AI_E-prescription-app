import { History } from "lucide-react";
import { BRAND } from "../branding.js";
import { formatDate } from "../printTemplate.js";
import { localToday } from "../dates.js";

// Top bar: logo, product name, today's date, and History (past prescriptions).
// The doctor's name and Logout join the right-hand side once login exists.
export function AppNavbar({ onHistory }) {
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
      </div>
    </header>
  );
}

// The navy letterhead band at the top of the sheet, like a printed pad.
export function SheetLetterhead() {
  return (
    <header className="sheet-letterhead">
      <div className="letterhead-logo">
        <img src={BRAND.logoUrl} alt={`${BRAND.institution} logo`} width="56" height="56" />
      </div>
      <div className="letterhead-text">
        <h1>E-Prescription</h1>
        <p className="letterhead-institution">{BRAND.institution}</p>
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
