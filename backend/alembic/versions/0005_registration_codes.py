"""registration codes; doctors' designation and approval

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-17

- registration_codes: one-time codes (hashed) a new doctor uses to register.
- doctors: + designation, + approved (existing accounts are approved).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('registration_codes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code_hash', sa.String(length=255), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('note', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('used_by', sa.Integer(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id']),
        sa.ForeignKeyConstraint(['created_by'], ['doctors.id']),
        sa.ForeignKeyConstraint(['used_by'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_registration_codes_expires_at', 'registration_codes', ['expires_at'])
    with op.batch_alter_table('doctors') as batch:
        batch.add_column(sa.Column('approved', sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column('designation', sa.String(length=120), nullable=False, server_default=''))


def downgrade() -> None:
    raise NotImplementedError("0005 can't be downgraded; restore a backup from before the upgrade.")
