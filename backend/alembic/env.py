"""Alembic environment. The database is the app's own (DATABASE_URL), and the
target schema is the SQLAlchemy models in app/models.py."""
from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  (registers the tables on Base.metadata)
from app.database import Base, engine

config = context.config
# Only from the command line; when the app runs migrations at startup it keeps
# its own logging setup.
if config.config_file_name is not None and not config.attributes.get("connection"):
    fileConfig(config.config_file_name, disable_existing_loggers=False)


def run_migrations_online():
    def configure_and_run(connection):
        context.configure(
            connection=connection,
            target_metadata=Base.metadata,
            # SQLite can't ALTER most things; "batch" mode rebuilds the table instead.
            render_as_batch=connection.dialect.name == "sqlite",
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()

    connection = config.attributes.get("connection")
    if connection is not None:  # called from app/migrations.py
        configure_and_run(connection)
    else:  # alembic command line
        with engine.connect() as connection:
            configure_and_run(connection)


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) mode isn't used here; run against the database.")
run_migrations_online()
