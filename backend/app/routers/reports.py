"""Reports (services/reports.py): add a file to a saved visit, open it, remove
your own. Every visit of the department, like the visits themselves; another
department's answers exactly like a missing one."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect

from ..clock import local_today
from ..database import get_db
from ..models import ClinicalForm, Doctor, Report
from ..security import current_doctor
from ..services import patients as patient_service
from ..services import reports

logger = logging.getLogger(__name__)
router = APIRouter(tags=["reports"])


def _error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, {"error_code": code, "message": message, **extra})


def _too_large() -> HTTPException:
    mb = reports.settings.REPORT_MAX_FILE_MB
    return _error(413, "too_large", f"That file is larger than {mb:g} MB, the most one file may be.", max_mb=mb)


def _no_room() -> HTTPException:
    return _error(507, "storage_full", "The server is short of space for reports. Please tell the administrator.")


def _report_in_department(db: Session, doctor: Doctor, report_id: int) -> Report:
    report = (
        db.query(Report).join(ClinicalForm, ClinicalForm.id == Report.form_id)
        .filter(Report.id == report_id, ClinicalForm.department_id == doctor.department_id)
        .first()
    )
    if report is None:
        raise _error(404, "not_found", "That file wasn't found.")
    return report


@router.get("/api/reports/types")
def report_types(doctor: Doctor = Depends(current_doctor)):
    """What can be added: [{key, label, tests}]; a category with tests also
    takes a typed name ("Other")."""
    return {"categories": list(reports.for_doctor(doctor)), "max_mb": reports.settings.REPORT_MAX_FILE_MB}


@router.post("/api/forms/{pid}/reports")
async def add_report(
    pid: str,
    request: Request,
    category: str = Query(..., max_length=40),
    test: str = Query("", max_length=200),
    name: str = Query("", max_length=1000, description="The file's name on the device"),
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    """The request body is the file itself (no form encoding), so it is
    written to disk as it arrives and stopped as soon as it is too large."""
    choice = reports.check_choice(doctor, category, test)
    if isinstance(choice, str):
        raise _error(400, "validation", choice)
    record = (
        db.query(ClinicalForm)
        .filter(ClinicalForm.pid == pid, ClinicalForm.department_id == doctor.department_id)
        .first()
    )
    if record is None:
        raise _error(404, "not_found", f"No saved prescription found for Reference ID {pid}.")
    form_id, patient_id, doctor_id = record.id, record.patient_id, doctor.id
    # Don't hold a database connection while a large file arrives.
    db.rollback()

    limit = reports.max_bytes()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise _too_large()
    if not await run_in_threadpool(reports.room_for, int(declared) if declared and declared.isdigit() else limit):
        raise _no_room()

    relative = reports.new_path(local_today())
    target = reports.folder() / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    size, head, media_type = 0, b"", None
    try:
        with open(target, "xb") as out:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > limit:
                    raise _too_large()
                if media_type is None:
                    head += chunk[: reports.HEAD_BYTES]
                    if len(head) >= reports.HEAD_BYTES:
                        media_type = reports.sniff(head)
                        if media_type is None:
                            raise _error(415, "unsupported_type", "Only PDF files, pictures and videos can be added.")
                await run_in_threadpool(out.write, chunk)
        if media_type is None:  # a file shorter than the bytes looked at
            media_type = reports.sniff(head) if size else None
            if media_type is None:
                raise _error(415, "unsupported_type", "Only PDF files, pictures and videos can be added.")
    except HTTPException:
        reports.remove_file(relative)
        raise
    except ClientDisconnect:
        reports.remove_file(relative)
        raise _error(400, "cancelled", "The upload was stopped.")
    except OSError:
        logger.exception("A report couldn't be written to %s", reports.folder())
        reports.remove_file(relative)
        raise _no_room()

    report = Report(
        form_id=form_id, category=choice[0], test=choice[1], file_name=reports.clean_file_name(name),
        media_type=media_type, size=size, path=relative, uploaded_by=doctor_id,
    )
    try:
        db.add(report)
        patient_service.log_access(db, doctor, "add_report", patient_id, form_id)
        db.commit()
    except Exception:
        db.rollback()
        reports.remove_file(relative)
        raise
    db.refresh(report)
    return reports.stored(report, doctor)


@router.get("/api/reports/{report_id}/file")
def open_report(
    report_id: int,
    request: Request,
    download: bool = False,
    db: Session = Depends(get_db),
    doctor: Doctor = Depends(current_doctor),
):
    report = _report_in_department(db, doctor, report_id)
    path = reports.file_of(report)
    if path is None:
        raise _error(404, "not_found", "That file is missing on the server.")
    # A video asks for many pieces while it plays: one entry per opening.
    piece = request.headers.get("range", "")
    if not piece or piece.replace(" ", "").startswith("bytes=0-"):
        form = db.get(ClinicalForm, report.form_id)
        patient_service.log_access(db, doctor, "view_report", form.patient_id if form else None, report.form_id)
        db.commit()
    return FileResponse(
        path,
        media_type=report.media_type,
        filename=report.file_name,
        content_disposition_type="attachment" if download else "inline",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete("/api/reports/{report_id}")
def remove_report(report_id: int, db: Session = Depends(get_db), doctor: Doctor = Depends(current_doctor)):
    """Only the person who added a file may remove it; the removal is logged."""
    report = _report_in_department(db, doctor, report_id)
    if report.uploaded_by != doctor.id:
        raise _error(403, "forbidden", "Only the person who added this file can remove it.")
    form = db.get(ClinicalForm, report.form_id)
    relative = report.path
    db.delete(report)
    patient_service.log_access(db, doctor, "remove_report", form.patient_id if form else None, report.form_id)
    db.commit()
    reports.remove_file(relative)
    return {"removed": report_id}
