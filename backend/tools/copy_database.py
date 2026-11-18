"""
Copy every record from one database to another — e.g. moving from SQLite to
PostgreSQL. The source is only read; the target must be empty.

    cd backend
    python -m tools.copy_database --from sqlite:///./clinical_forms.db --to postgresql://USER:PASSWORD@localhost:5432/cvf

1. Stop the app first, so nothing is saved during the copy.
2. Back up the source (python -m tools.backup_database).
3. Run this. It checks everything first, then copies in ONE transaction:
   either every record arrives or none does.
4. Set DATABASE_URL in .env to the target and start the app.

Uploaded report FILES are not in the database: if the app moves to another
machine, copy the REPORTS_DIR folder too (the database only points at them).
"""
import argparse
import sys

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url

from app import migrations, models  # noqa: F401  (registers the tables)
from app.database import Base, make_engine, normalize_url

BATCH = 500
# Rows the migrations themselves insert (e.g. "ENT Department"): a freshly
# migrated target has them, so they don't make it "not empty"; they are
# replaced by the source's own rows during the copy.
SEED_TABLES = {"departments"}


def _redact(url: str) -> str:
    return make_url(normalize_url(url)).render_as_string(hide_password=True)


def _revision(engine):
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def _too_long(conn, table):
    """Values the target would reject (SQLite never enforced column sizes)."""
    problems = []
    for col in table.columns:
        limit = getattr(col.type, "length", None)
        if limit:
            n = conn.execute(select(func.count()).select_from(table).where(func.length(col) > limit)).scalar()
            if n:
                problems.append(f"{table.name}.{col.name}: {n} value(s) longer than {limit} characters")
    return problems


def copy(source_url: str, target_url: str) -> dict:
    source, target = make_engine(source_url), make_engine(target_url)
    try:
        head = ScriptDirectory.from_config(Config(str(migrations.ALEMBIC_INI))).get_current_head()
        if _revision(source) != head:
            raise SystemExit(
                "The source database isn't at the current schema. Start the app on it once "
                "(it updates the schema itself), stop it, then copy."
            )

        tables = Base.metadata.sorted_tables  # parents before children (foreign keys)
        migrations.run(target)  # empty target -> current schema; never touches the source
        with target.connect() as conn:
            filled = [t.name for t in tables if t.name not in SEED_TABLES
                      and conn.execute(select(func.count()).select_from(t)).scalar()]
        if filled:
            raise SystemExit(f"The target already has records ({', '.join(filled)}). It must be empty.")

        with source.connect() as conn:
            problems = [p for t in tables for p in _too_long(conn, t)]
        if problems:
            raise SystemExit("Fix these in the source first (nothing was copied):\n  " + "\n  ".join(problems))

        counts = {}
        with source.connect() as src, target.begin() as dst:
            for table in reversed(tables):
                if table.name in SEED_TABLES:
                    dst.execute(table.delete())
            for table in tables:
                counts[table.name] = 0
                result = src.execute(select(table).order_by(*table.primary_key.columns))
                while rows := result.mappings().fetchmany(BATCH):
                    dst.execute(table.insert(), [dict(r) for r in rows])
                    counts[table.name] += len(rows)
            if dst.dialect.name == "postgresql":
                # Copied rows keep their ids; move each id counter past them.
                for table in tables:
                    dst.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                        f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table.name}"
                    ))
            for table in tables:  # checked inside the transaction: a mismatch copies nothing
                got = dst.execute(select(func.count()).select_from(table)).scalar()
                if got != counts[table.name]:
                    raise RuntimeError(f"{table.name}: copied {counts[table.name]}, target has {got}")
        return counts
    finally:
        source.dispose()
        target.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Copy all records to an empty database.")
    parser.add_argument("--from", dest="source", required=True, help="source DATABASE_URL")
    parser.add_argument("--to", dest="target", required=True, help="target DATABASE_URL (empty)")
    args = parser.parse_args(argv)
    if normalize_url(args.source) == normalize_url(args.target):
        raise SystemExit("Source and target are the same database.")
    print(f"Copying {_redact(args.source)} -> {_redact(args.target)}")
    counts = copy(args.source, args.target)
    for name, n in counts.items():
        print(f"  {name}: {n}")
    print("Done. Every record copied and counted. Now set DATABASE_URL to the target.")
    print("Report files are not in the database: on a new machine, copy the REPORTS_DIR folder too.")


if __name__ == "__main__":
    sys.exit(main())
