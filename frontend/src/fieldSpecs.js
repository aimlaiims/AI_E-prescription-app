// Mirrors backend/app/schemas.py FORM_FIELD_SPECS — keep these in sync.
// (If this project grows, expose this from a /api/schema endpoint instead
// of duplicating it, but for a single-form MVP this keeps things simple.)
export const FIELD_SPECS = {
  patient_name: { label: "Patient name", type: "text", required: true },
  date: { label: "Date", type: "date", required: false },
  age: { label: "Age", type: "text", required: true },
  gender: {
    label: "Gender",
    type: "enum",
    options: ["Male", "Female", "Other"],
    required: true,
  },
  chief_complaints: { label: "Chief complaints", type: "textarea", required: true },
  on_examination: { label: "On examination", type: "textarea", required: false },
  diagnosis: { label: "Diagnosis", type: "textarea", required: true },
  investigation: { label: "Investigation", type: "textarea", required: false },
  medications: { label: "Medications", type: "textarea", required: false },
};

export const EMPTY_STATE = Object.fromEntries(
  Object.keys(FIELD_SPECS).map((k) => [k, ""])
);
