"""
Brings the database schema up to date at startup: runs the Alembic migrations
in backend/alembic/versions/ ("upgrade head"). Works on SQLite and PostgreSQL.

A database made before Alembic (SQLite) is adopted by the first migration,
which only creates what is missing — see 0001_baseline.py.

SQLite needs care: most schema changes rebuild a table (copy, drop, rename),
which foreign keys would block, and Python's sqlite3 module doesn't wrap DDL
in a transaction by itself. So on SQLite the migrations run on their own
connection with foreign keys paused, inside ONE real transaction
(all-or-nothing), and every foreign key is checked before it commits.

Changing the schema: edit app/models.py, then from backend/
    alembic revision --autogenerate -m "what changed"
read and fix the generated file, and test it on a copy of a real database.
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text

logger = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def _sqlite_migration_engine(url):
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _record):
        dbapi_conn.isolation_level = None  # we issue BEGIN ourselves (below)
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")  # must be set outside a transaction
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN IMMEDIATE")  # DDL and data in one transaction

    return engine


def run(engine):
    config = Config(str(ALEMBIC_INI))
    if engine.dialect.name != "sqlite":
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    else:
        migration_engine = _sqlite_migration_engine(engine.url)
        try:
            with migration_engine.begin() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "head")
                broken = connection.execute(text("PRAGMA foreign_key_check")).all()
                if broken:
                    raise RuntimeError(f"Migration left broken foreign keys {broken[:5]}; nothing was changed.")
        finally:
            migration_engine.dispose()
    logger.info("database schema up to date (%s)", engine.dialect.name)
