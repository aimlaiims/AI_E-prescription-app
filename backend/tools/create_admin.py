"""
Create THE administrator (there is one), or make an existing account it.
Run on the server, from backend/:

    python -m tools.create_admin --email admin@example.org --name "Full Name"

Asks for the password (typed twice, not shown). The administrator then
manages every department's accounts from the app (navbar -> Accounts):
registration codes for new doctors, approvals, deactivation.

Options:
  --department CODE        the administrator's own department (default ENT); their
                           own prescriptions are shared only within it
  --department-name NAME   create that department if it doesn't exist yet
  --replace                another account is administrator: make it a plain
                           doctor and this one the administrator
"""
import argparse
import getpass
import sys

from app import migrations
from app.database import SessionLocal, engine
from app.models import Department, Doctor
from app.routers.auth import email_problem
from app.services import auth as auth_service


def create_admin(email: str, name: str, password: str | None, department_code: str = "ENT",
                 department_name: str = "", replace: bool = False) -> str:
    """Returns what was done. `password` may be None only for an existing account."""
    email = auth_service.normalize_email(email)
    if problem := email_problem(email):
        raise SystemExit(f"Please give {problem}.")
    with SessionLocal() as db:
        code = department_code.strip().upper()
        department = db.query(Department).filter(Department.code == code).first()
        if department is None and department_name.strip():
            department = Department(code=code, name=department_name.strip())
            db.add(department)
            db.flush()
        if department is None:
            raise SystemExit(f"No department with code {department_code!r} (add --department-name to create it).")

        others = db.query(Doctor).filter(Doctor.role == "admin", Doctor.email != email).all()
        if others and not replace:
            raise SystemExit(
                f"There is already an administrator ({', '.join(o.email for o in others)}). "
                "There is only one; add --replace to make this account the administrator instead.")
        for o in others:
            o.role = "doctor"

        doctor = auth_service.find_doctor(db, email)
        if doctor is not None:
            doctor.role, doctor.is_active, doctor.approved, doctor.department_id = "admin", True, True, department.id
            db.commit()
            return f"{email} is now the administrator ({department.name})."
        if not name.strip():
            raise SystemExit("Please give the administrator's name (--name).")
        if not password or len(password) < auth_service.MIN_PASSWORD_LENGTH:
            raise SystemExit(f"The password must have at least {auth_service.MIN_PASSWORD_LENGTH} characters.")
        db.add(Doctor(full_name=name.strip(), email=email, role="admin", department_id=department.id,
                      password_hash=auth_service.hash_password(password)))
        db.commit()
        return f"Administrator {email} created ({department.name}). Sign in with this email."


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create or set the administrator.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="", help="full name, as printed (needed for a new account)")
    parser.add_argument("--department", default="ENT", help="the administrator's own department code (default ENT)")
    parser.add_argument("--department-name", default="", help="create the department with this name if missing")
    parser.add_argument("--replace", action="store_true", help="replace the current administrator")
    args = parser.parse_args(argv)

    migrations.run(engine)  # make sure the schema (and the ENT department) exists
    password = None
    with SessionLocal() as db:
        exists = auth_service.find_doctor(db, args.email) is not None
    if not exists:
        password = getpass.getpass("Password for the new administrator: ")
        if password != getpass.getpass("Same password again: "):
            raise SystemExit("The two passwords don't match. Nothing was created.")
    print(create_admin(args.email, args.name, password, args.department, args.department_name, args.replace))


if __name__ == "__main__":
    sys.exit(main())
