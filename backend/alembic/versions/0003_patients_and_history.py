"""patients (shared by the department), access log; visits linked to patients

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07

- patients: our Patient ID (department + number), the hospital OPD number
  (optional, unique per department), name, gender, occupation, city.
- access_log: who opened / wrote which patient's record, and when.
- clinical_forms (visits): + patient_id, and the visit's own copy of OPD No.,
  occupation and city.
- Every existing prescription becomes ONE patient of its own (numbered in
  the order saved). Nothing is merged by guessing — doctors link repeat
  visits from then on.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('patients',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('patient_no', sa.Integer(), nullable=False),
        sa.Column('opd_no', sa.String(length=40), nullable=True),
        sa.Column('full_name', sa.String(length=200), nullable=False),
        sa.Column('gender', sa.String(length=20), nullable=False),
        sa.Column('occupation', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('city', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id']),
        sa.ForeignKeyConstraint(['created_by'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'patient_no', name='uq_patients_department_patient_no'),
        sa.UniqueConstraint('department_id', 'opd_no', name='uq_patients_department_opd_no'),
    )
    op.create_index('ix_patients_department_id', 'patients', ['department_id'])
    op.create_index('ix_patients_full_name', 'patients', ['full_name'])

    op.create_table('access_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('at', sa.DateTime(), nullable=False),
        sa.Column('doctor_id', sa.Integer(), nullable=False),
        sa.Column('patient_id', sa.Integer(), nullable=True),
        sa.Column('form_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=30), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.id']),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id']),
        sa.ForeignKeyConstraint(['form_id'], ['clinical_forms.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_access_log_at', 'access_log', ['at'])
    op.create_index('ix_access_log_doctor_id', 'access_log', ['doctor_id'])
    op.create_index('ix_access_log_patient_id', 'access_log', ['patient_id'])

    with op.batch_alter_table('clinical_forms') as batch:
        batch.add_column(sa.Column('patient_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('opd_no', sa.String(length=40), nullable=False, server_default=''))
        batch.add_column(sa.Column('occupation', sa.String(length=120), nullable=False, server_default=''))
        batch.add_column(sa.Column('city', sa.String(length=120), nullable=False, server_default=''))
        batch.create_foreign_key('fk_clinical_forms_patient_id', 'patients', ['patient_id'], ['id'])
        batch.create_index('ix_clinical_forms_patient_id', ['patient_id'])

    # One patient per existing prescription, in the order they were saved.
    bind = op.get_bind()
    ent = bind.execute(sa.text("SELECT id FROM departments WHERE code = 'ENT'")).scalar_one()
    rows = bind.execute(sa.text(
        "SELECT id, department_id, patient_name, gender, created_at FROM clinical_forms ORDER BY id"
    )).all()
    next_no = {}
    for form_id, department_id, name, gender, created_at in rows:
        department_id = department_id or ent
        next_no[department_id] = next_no.get(department_id, 0) + 1
        bind.execute(sa.text(
            "INSERT INTO patients (department_id, patient_no, full_name, gender, occupation, city, created_at, updated_at)"
            " VALUES (:d, :n, :name, :gender, '', '', :at, :at)"
        ), {"d": department_id, "n": next_no[department_id], "name": name, "gender": gender, "at": created_at})
        patient_id = bind.execute(sa.text(
            "SELECT id FROM patients WHERE department_id = :d AND patient_no = :n"
        ), {"d": department_id, "n": next_no[department_id]}).scalar_one()
        bind.execute(sa.text(
            "UPDATE clinical_forms SET patient_id = :p, department_id = :d WHERE id = :f"
        ), {"p": patient_id, "d": department_id, "f": form_id})


def downgrade() -> None:
    raise NotImplementedError("0003 can't be downgraded; restore a backup from before the upgrade.")
