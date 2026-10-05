from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import settings


def normalize_url(url: str) -> str:
    """SQLite or PostgreSQL. A plain postgresql:// (or postgres://) URL would
    make SQLAlchemy look for the psycopg2 driver; we ship psycopg 3."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def make_engine(url: str):
    url = normalize_url(url)
    if not url.startswith("sqlite"):
        # pool_pre_ping: survive a database restart without failing the next request.
        return create_engine(url, pool_pre_ping=True)

    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        # Enforce foreign keys like PostgreSQL does (SQLite ignores them by default).
        cur.execute("PRAGMA foreign_keys=ON")
        # WAL: reads don't wait for a save in progress. Not for network drives.
        cur.execute("PRAGMA journal_mode=WAL")
        # Two saves at the same moment: wait up to 5 s instead of failing.
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    return engine


engine = make_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
