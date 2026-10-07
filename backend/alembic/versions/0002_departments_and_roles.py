"""departments, roles, deactivation; sign in by email (Doctor ID removed)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-07

- New `departments` table with "ENT Department" (code ENT). Every existing
  account and prescription is placed in it.
- doctors: + department_id, role ("doctor" | "admin"), is_active;
  - doctor_id (the old login name): sign-in is by email now.
- clinical_forms: + department_id.
- password_resets: + purpose ("reset" | "invite").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    departments = op.create_table('departments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='uq_departments_code'),
    )
    op.bulk_insert(departments, [{'code': 'ENT', 'name': 'ENT Department'}])
    ent = op.get_bind().execute(sa.text("SELECT id FROM departments WHERE code = 'ENT'")).scalar_one()

    with op.batch_alter_table('doctors') as batch:
        batch.add_column(sa.Column('department_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('role', sa.String(length=20), nullable=False, server_default='doctor'))
        batch.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.drop_index('ix_doctors_doctor_id')
        batch.drop_column('doctor_id')
        batch.create_foreign_key('fk_doctors_department_id', 'departments', ['department_id'], ['id'])
        batch.create_index('ix_doctors_department_id', ['department_id'])
    op.execute(sa.text("UPDATE doctors SET department_id = :ent").bindparams(ent=ent))

    with op.batch_alter_table('clinical_forms') as batch:
        batch.add_column(sa.Column('department_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_clinical_forms_department_id', 'departments', ['department_id'], ['id'])
        batch.create_index('ix_clinical_forms_department_id', ['department_id'])
    op.execute(sa.text("UPDATE clinical_forms SET department_id = :ent").bindparams(ent=ent))

    with op.batch_alter_table('password_resets') as batch:
        batch.add_column(sa.Column('purpose', sa.String(length=20), nullable=False, server_default='reset'))


def downgrade() -> None:
    # The removed login names can't be restored; restore a backup instead.
    raise NotImplementedError("0002 can't be downgraded; restore a backup from before the upgrade.")
