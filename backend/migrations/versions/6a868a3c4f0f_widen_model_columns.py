"""widen model columns, conversation list index

Revision ID: 6a868a3c4f0f
Revises: 5c3e88b82814
Create Date: 2026-10-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6a868a3c4f0f'
down_revision: Union[str, None] = '5c3e88b82814'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # "cp:<uuid>:<model id>" havolasi 100 belgidan oshishi mumkin (javob saqlanmay qolardi)
    op.alter_column('messages', 'model', existing_type=sa.String(length=100), type_=sa.String(length=300),
                    existing_nullable=True)
    op.alter_column('usage_events', 'model', existing_type=sa.String(length=100), type_=sa.String(length=300),
                    existing_nullable=False)
    # Ba'zi muhitlarda indeks allaqachon yaratilgan: qayta yaratishda xato bermasin
    op.create_index('ix_conversations_user_updated', 'conversations', ['user_id', 'updated_at'], unique=False,
                    if_not_exists=True)


def downgrade() -> None:
    op.drop_index('ix_conversations_user_updated', table_name='conversations', if_exists=True)
    op.alter_column('usage_events', 'model', existing_type=sa.String(length=300), type_=sa.String(length=100),
                    existing_nullable=False, postgresql_using='left(model, 100)')
    op.alter_column('messages', 'model', existing_type=sa.String(length=300), type_=sa.String(length=100),
                    existing_nullable=True, postgresql_using='left(model, 100)')
