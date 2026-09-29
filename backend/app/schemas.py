from typing import Optional
from pydantic import BaseModel, Field, field_validator

# The single source of truth for which fields exist and their type/description.
# Both the extraction prompt and the frontend form are driven off this shape,
# so adding a field to the form later means editing it in exactly one place.
FORM_FIELD_SPECS = {
    "patient_name": {"label": "Patient name", "type": "text"},
    "date": {"label": "Date", "type": "date"},
    "age": {"label": "Age", "type": "text"},
    "gender": {"label": "Gender", "type": "enum", "options": ["Male", "Female", "Other"]},
    "chief_complaints": {"label": "Chief complaints", "type": "textarea"},
    "on_examination": {"label": "On examination", "type": "textarea"},
    "diagnosis": {"label": "Diagnosis", "type": "textarea"},
    "investigation": {"label": "Investigation", "type": "textarea"},
    "medications": {"label": "Medications", "type": "textarea"},
}

REQUIRED_FIELDS = {"patient_name", "age", "gender", "chief_complaints", "diagnosis"}


class FormState(BaseModel):
    patient_name: str = ""
    date: str = ""
    age: str = ""
    gender: str = ""
    chief_complaints: str = ""
    on_examination: str = ""
    diagnosis: str = ""
    investigation: str = ""
    medications: str = ""


class TranscribeResponse(BaseModel):
    transcript: str


class ExtractRequest(BaseModel):
    transcript: str
    current_state: FormState
    # If set, extraction is restricted to just this one field (per-field mic mode).
    # Much higher accuracy than whole-form free dictation.
    target_field: Optional[str] = None

    @field_validator("target_field")
    @classmethod
    def _known_field(cls, v: Optional[str]) -> Optional[str]:
        # An unknown key used to reach the prompt builder and 500 (KeyError).
        if v is not None and v not in FORM_FIELD_SPECS:
            raise ValueError(f"unknown field: {v}")
        return v


class FieldUpdate(BaseModel):
    field: str
    old_value: str
    new_value: str
    # short reason the model grounded this in the transcript, shown to the doctor
    # so a rejected/accepted update is auditable, not a black box.
    evidence: str = ""


class ExtractResponse(BaseModel):
    updates: list[FieldUpdate] = Field(default_factory=list)
    unmatched_transcript_note: str = ""


class SaveFormRequest(BaseModel):
    state: FormState
    raw_transcript_log: str = ""


class SaveFormResponse(BaseModel):
    pid: str
    saved_at: str
