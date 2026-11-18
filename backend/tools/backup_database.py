"""
Back up the app's database (DATABASE_URL in .env) into a dated file. Safe
while the app is running.

    cd backend
    python -m tools.backup_database                      # into backend/backups/, keeps 30
    python -m tools.backup_database --to D:\\cvf-backups --keep 60

Keep backups on a DIFFERENT disk or machine than the database, and run this on
a schedule (Windows Task Scheduler / cron). A backup is only proven once it has
been restored — see README "Database and backups".

SQLite:      a .db file made with SQLite's own backup function (a plain file
             copy while the app is writing can be corrupt), then checked.
PostgreSQL:  a .dump file made with pg_dump (installed with PostgreSQL).
Reports:     the uploaded files (REPORTS_DIR) are copied into <folder>/reports;
             only files not copied before (they never change once added).
             A file removed in the app stays in the backup.
"""
import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import settings
from app.database import normalize_url

DEFAULT_DIR = Path(__file__).resolve().parents[1] / "backups"


def _sqlite_backup(url, folder: Path, stamp: str) -> Path:
    source = Path(url.database)
    if not source.is_file():
        raise SystemExit(f"No database file at {source}")
    out = folder / f"{source.stem}-{stamp}.db"
    src = sqlite3.connect(source)
    dst = sqlite3.connect(out)
    try:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("The backup failed its integrity check. Nothing kept.")
        dst.execute("PRAGMA journal_mode=DELETE")  # one self-contained file
    except BaseException:
        dst.close()
        out.unlink(missing_ok=True)
        raise
    finally:
        src.close()
        dst.close()
    return out


def _postgres_backup(url, folder: Path, stamp: str) -> Path:
    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        raise SystemExit("pg_dump not found. It comes with PostgreSQL; add its bin folder to PATH.")
    out = folder / f"{url.database}-{stamp}.dump"
    # The password goes in the environment, not the command line (visible to other users).
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    cmd = [pg_dump, "--format=custom", f"--file={out}", f"--host={url.host or 'localhost'}",
           f"--port={url.port or 5432}", f"--username={url.username or 'postgres'}", url.database]
    if subprocess.run(cmd, env=env).returncode != 0:
        out.unlink(missing_ok=True)
        raise SystemExit("pg_dump failed (see above). Nothing kept.")
    return out


def backup(database_url: str, folder: Path, keep: int) -> Path:
    url = make_url(normalize_url(database_url))
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backend = url.get_backend_name()
    if backend == "sqlite":
        out = _sqlite_backup(url, folder, stamp)
    elif backend == "postgresql":
        out = _postgres_backup(url, folder, stamp)
    else:
        raise SystemExit(f"Don't know how to back up a {backend} database.")

    if keep > 0:  # delete the oldest, only among this tool's files for this database
        prefix = out.name[: -len(f"-{stamp}{out.suffix}")]
        mine = sorted(folder.glob(f"{prefix}-????????-??????{out.suffix}"))
        for old in mine[:-keep]:
            old.unlink()
    return out


def copy_reports(source: Path, folder: Path) -> int:
    """New report files from `source` into folder/reports, same layout.
    Returns how many were copied."""
    if not source.is_dir():
        return 0
    target = folder / "reports"
    copied = 0
    for f in source.rglob("*"):
        if not f.is_file():
            continue
        out = target / f.relative_to(source)
        if out.is_file() and out.stat().st_size == f.stat().st_size:
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        part = out.with_name(out.name + ".part")
        shutil.copy2(f, part)
        part.replace(out)
        copied += 1
    return copied


def main(argv=None):
    parser = argparse.ArgumentParser(description="Back up the database to a dated file.")
    parser.add_argument("--to", type=Path, default=DEFAULT_DIR, help="backup folder")
    parser.add_argument("--keep", type=int, default=30, help="how many backups to keep (0 = all)")
    args = parser.parse_args(argv)
    out = backup(settings.DATABASE_URL, args.to, args.keep)
    print(f"Backup written: {out} ({out.stat().st_size:,} bytes)")
    copied = copy_reports(Path(settings.REPORTS_DIR).resolve(), args.to)
    print(f"Report files: {copied} new copied to {args.to / 'reports'}")


if __name__ == "__main__":
    sys.exit(main())
