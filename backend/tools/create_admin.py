"""
Create the department's first administrator (or make an existing account one).
Run once on the server, from backend/:

    python -m tools.create_admin --email hod.ent@example.org --name "Anika Rao"

Asks for the password (typed twice, not shown). The admin then adds every other
account from the app (navbar -> Accounts). --department defaults to ENT.
"""
import argparse
import getpass
import sys

from app import migrations
from app.database import SessionLocal, engine
from app.models import Department, Doctor
from app.routers.auth import email_problem
from app.services import auth as auth_service


def create_admin(email: str, name: str, password: str | None, department_code: str = "ENT") -> str:
    """Returns what was done. `password` may be None only for an existing account."""
    email = auth_service.normalize_email(email)
    if problem := email_problem(email):
        raise SystemExit(f"Please give {problem}.")
    with SessionLocal() as db:
        department = db.query(Department).filter(Department.code == department_code.upper()).first()
        if department is None:
            raise SystemExit(f"No department with code {department_code!r}.")
        doctor = auth_service.find_doctor(db, email)
        if doctor is not None:
            doctor.role, doctor.is_active, doctor.department_id = "admin", True, department.id
            db.commit()
            return f"{email} is now an administrator of {department.name}."
        if not name.strip():
            raise SystemExit("Please give the administrator's name (--name).")
        if not password or len(password) < auth_service.MIN_PASSWORD_LENGTH:
            raise SystemExit(f"The password must have at least {auth_service.MIN_PASSWORD_LENGTH} characters.")
        db.add(Doctor(full_name=name.strip(), email=email, role="admin", department_id=department.id,
                      password_hash=auth_service.hash_password(password)))
        db.commit()
        return f"Administrator {email} created for {department.name}. Sign in with this email."


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create or promote a department administrator.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="", help="full name, as printed (needed for a new account)")
    parser.add_argument("--department", default="ENT", help="department code (default ENT)")
    args = parser.parse_args(argv)

    migrations.run(engine)  # make sure the schema (and the ENT department) exists
    password = None
    with SessionLocal() as db:
        exists = auth_service.find_doctor(db, args.email) is not None
    if not exists:
        password = getpass.getpass("Password for the new administrator: ")
        if password != getpass.getpass("Same password again: "):
            raise SystemExit("The two passwords don't match. Nothing was created.")
    print(create_admin(args.email, args.name, password, args.department))


if __name__ == "__main__":
    sys.exit(main())
