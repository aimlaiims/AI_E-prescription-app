// How the signed-in doctor is shown: navbar, letterhead band, printed page.
// Pure functions (tested in doctor.test.js).

// "Dr. Anika Rao" — whether or not the doctor typed "Dr." in their name.
export function doctorDisplayName(fullName) {
  const name = String(fullName ?? "").trim().replace(/^dr\.?\s+/i, "").trim();
  return name ? `Dr. ${name}` : "";
}

// "Senior Resident · MBBS, MD · General Medicine" (skips whatever is empty).
export function doctorCredentials(doctor) {
  return [doctor?.designation, doctor?.qualification, doctor?.specialization]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

// Letterhead for buildPrintHtml(): institution, department, doctor + credentials, reg. no.
export function doctorLetterhead(profile, logoDataUri, fallbackInstitution) {
  const doctor = profile?.doctor;
  const name = doctorDisplayName(doctor?.full_name);
  const credentials = doctorCredentials(doctor);
  const reg = String(doctor?.registration_no ?? "").trim();
  return {
    clinicName: profile?.institution || fallbackInstitution || undefined,
    departmentName: String(profile?.department?.name ?? "").trim() || undefined,
    doctorName: [name, credentials].filter(Boolean).join(", ") || undefined,
    registrationNo: reg ? `Reg. No. ${reg}` : undefined,
    logoDataUri: logoDataUri || undefined,
  };
}
