"""baseline: doctors, sessions, password resets, prescriptions

Revision ID: 0001
Revises:
Create Date: 2026-10-05

Also adopts databases made before Alembic (SQLite only — PostgreSQL support
starts here): those were built by `create_all()` plus the old hand-written
startup steps. Every step checks first and creates only what is missing, so
an existing database keeps all its data and ends up exactly like a new one.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_table(existing, name, *columns):
    if name not in existing:
        op.create_table(name, *columns)


def _create_index(name, table, columns, unique=False):
    indexes = {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(table)}
    if name not in indexes:
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    _create_table(existing, 'doctors',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('doctor_id', sa.String(length=40), nullable=False),
        sa.Column('full_name', sa.String(length=120), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('qualification', sa.String(length=120), nullable=True),
        sa.Column('specialization', sa.String(length=120), nullable=True),
        sa.Column('registration_no', sa.String(length=60), nullable=True),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    _create_index('ix_doctors_doctor_id', 'doctors', ['doctor_id'], unique=True)
    _create_index('ix_doctors_email', 'doctors', ['email'], unique=True)

    _create_table(existing, 'auth_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('doctor_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    _create_index('ix_auth_sessions_doctor_id', 'auth_sessions', ['doctor_id'])
    _create_index('ix_auth_sessions_token_hash', 'auth_sessions', ['token_hash'], unique=True)

    _create_table(existing, 'clinical_forms',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pid', sa.String(length=32), nullable=False),
        sa.Column('doctor_id', sa.Integer(), nullable=True),
        sa.Column('patient_name', sa.String(length=200), nullable=False),
        sa.Column('date', sa.String(length=20), nullable=False),
        sa.Column('age', sa.String(length=40), nullable=False),
        sa.Column('gender', sa.String(length=20), nullable=False),
        sa.Column('chief_complaints', sa.Text(), nullable=False),
        sa.Column('on_examination', sa.Text(), nullable=True),
        sa.Column('diagnosis', sa.Text(), nullable=False),
        sa.Column('investigation', sa.Text(), nullable=True),
        sa.Column('medications', sa.Text(), nullable=True),
        sa.Column('raw_transcript_log', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    # Pre-login SQLite databases: add the owner column. (Plain SQL: SQLite
    # accepts REFERENCES in ADD COLUMN, but not a separate ADD CONSTRAINT.)
    # Their `age` column says VARCHAR(10), but SQLite never enforces lengths.
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('clinical_forms')}
    if 'doctor_id' not in columns:
        op.execute('ALTER TABLE clinical_forms ADD COLUMN doctor_id INTEGER REFERENCES doctors(id)')
    _create_index('ix_clinical_forms_date', 'clinical_forms', ['date'])
    _create_index('ix_clinical_forms_doctor_id', 'clinical_forms', ['doctor_id'])
    _create_index('ix_clinical_forms_id', 'clinical_forms', ['id'])
    _create_index('ix_clinical_forms_patient_name', 'clinical_forms', ['patient_name'])
    _create_index('ix_clinical_forms_pid', 'clinical_forms', ['pid'], unique=True)

    _create_table(existing, 'password_resets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('doctor_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    _create_index('ix_password_resets_doctor_id', 'password_resets', ['doctor_id'])
    _create_index('ix_password_resets_token_hash', 'password_resets', ['token_hash'], unique=True)


def downgrade() -> None:
    # Dropping the whole schema would delete every prescription; never automated.
    raise NotImplementedError("The baseline can't be downgraded.")
