"""examination diagrams drawn on during a visit

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-17

- exam_drawings: one row per diagram the doctor drew on (strokes as JSON).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('exam_drawings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('form_id', sa.Integer(), nullable=False),
        sa.Column('diagram', sa.String(length=40), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('strokes', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['form_id'], ['clinical_forms.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('form_id', 'diagram', name='uq_exam_drawings_form_diagram'),
    )
    op.create_index('ix_exam_drawings_form_id', 'exam_drawings', ['form_id'])


def downgrade() -> None:
    raise NotImplementedError("0006 can't be downgraded; restore a backup from before the upgrade.")
