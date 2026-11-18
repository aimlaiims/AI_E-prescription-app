"""reports: files added to a visit

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-17

- reports: one row per uploaded file (the file itself is on disk, REPORTS_DIR).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('form_id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(length=40), nullable=False),
        sa.Column('test', sa.String(length=80), server_default='', nullable=False),
        sa.Column('file_name', sa.String(length=200), nullable=False),
        sa.Column('media_type', sa.String(length=60), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('path', sa.String(length=120), nullable=False),
        sa.Column('uploaded_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['form_id'], ['clinical_forms.id']),
        sa.ForeignKeyConstraint(['uploaded_by'], ['doctors.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('path'),
    )
    op.create_index('ix_reports_form_id', 'reports', ['form_id'])


def downgrade() -> None:
    raise NotImplementedError("0007 can't be downgraded; restore a backup from before the upgrade.")
