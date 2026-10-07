"""advice (incl. follow-up) on each visit

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('clinical_forms') as batch:
        batch.add_column(sa.Column('advice', sa.Text(), nullable=False, server_default=''))


def downgrade() -> None:
    raise NotImplementedError("0004 can't be downgraded; restore a backup from before the upgrade.")
