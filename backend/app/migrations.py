"""
Brings the database schema up to date at startup: runs the Alembic migrations
in backend/alembic/versions/ ("upgrade head"). Works on SQLite and PostgreSQL.

A database made before Alembic (SQLite) is adopted by the first migration,
which only creates what is missing — see 0001_baseline.py.

Changing the schema: edit app/models.py, then from backend/
    alembic revision --autogenerate -m "what changed"
read and fix the generated file, and test it on a copy of a real database.
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def run(engine):
    config = Config(str(ALEMBIC_INI))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
    logger.info("database schema up to date (%s)", engine.dialect.name)
