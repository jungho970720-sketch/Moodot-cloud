import logging
import os
import ssl
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

try:
    import asyncpg
except ImportError:  # pragma: no cover - dependency is optional outside RDS mode
    asyncpg = None

from security.memory_crypto import decrypt_memory_text

logger = logging.getLogger(__name__)

EMOTION_CATEGORIES = {
    "negative": ["bad", "sad"],
    "positive": ["good"],
    "neutral": ["calm"],
}


class WorkerPostgresStore:
    """RDS PostgreSQL data access used by the AI worker."""

    def __init__(self, pool):
        self.pool = pool

    @classmethod
    async def create(cls) -> "WorkerPostgresStore":
        if asyncpg is None:
            raise RuntimeError("asyncpg is required when WORKER_DATA_PROVIDER=rds.")

        database_url = (
            os.getenv("DATABASE_URL")
            or os.getenv("RDS_DATABASE_URL")
            or os.getenv("POSTGRES_URL")
        )
        ssl_enabled = os.getenv("DATABASE_SSL", "true").lower() != "false"
        ssl_context = None
        if ssl_enabled:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        if database_url:
            pool = await asyncpg.create_pool(
                dsn=database_url,
                ssl=ssl_context,
                min_size=1,
                max_size=int(os.getenv("DB_POOL_MAX_SIZE", "2")),
            )
        else:
            pool = await asyncpg.create_pool(
                host=os.getenv("DB_HOST") or os.getenv("PGHOST"),
                port=int(os.getenv("DB_PORT") or os.getenv("PGPORT") or "5432"),
                database=os.getenv("DB_NAME") or os.getenv("PGDATABASE") or "postgres",
                user=os.getenv("DB_USER") or os.getenv("PGUSER") or "postgres",
                password=os.getenv("DB_PASSWORD") or os.getenv("PGPASSWORD"),
                ssl=ssl_context,
                min_size=1,
                max_size=int(os.getenv("DB_POOL_MAX_SIZE", "2")),
            )

        return cls(pool)

    async def close(self) -> None:
        await self.pool.close()

    @staticmethod
    def _to_dict(row: Any) -> Dict[str, Any]:
        return dict(row)

    @staticmethod
    def _iso(value: Any) -> Any:
        return value.isoformat() if hasattr(value, "isoformat") else value

    def _memory_row(self, row: Any) -> Dict[str, Any]:
        item = self._to_dict(row)
        try:
            text = decrypt_memory_text(
                item.get("text_ciphertext"),
                item.get("text_iv"),
                item.get("text"),
            )
        except Exception as error:
            logger.warning("텍스트 복호화 실패 (id=%s): %s", item.get("id"), error)
            text = item.get("text") or ""

        return {
            "id": item["id"],
            "emotion_id": item.get("emotion_id"),
            "emotion_name": item.get("emotion") or "Unknown",
            "text": text or "",
            "created_at": self._iso(item.get("created_at")),
            "user_id": item.get("user_id"),
        }

    async def fetch_unprocessed_memories(
        self,
        before: datetime,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        rows = await self.pool.fetch(
            """
            select *
            from public.memories
            where processed = false
              and created_at < $1
            order by created_at
            limit $2
            """,
            before,
            limit,
        )
        return [self._to_dict(row) for row in rows]

    async def mark_memory_processed(self, memory_id: int) -> bool:
        result = await self.pool.execute(
            """
            update public.memories
            set processed = true
            where id = $1
            """,
            int(memory_id),
        )
        return result.endswith("1")

    async def get_emotion_name(self, emotion_id: int) -> str:
        row = await self.pool.fetchrow(
            """
            select emotion
            from public.emotion_categories
            where emotion_id = $1
            """,
            int(emotion_id),
        )
        return row["emotion"] if row else "Unknown"

    async def get_emotion_by_id(self, emotion_id: int) -> Optional[Dict[str, Any]]:
        row = await self.pool.fetchrow(
            """
            select emotion_id, emotion
            from public.emotion_categories
            where emotion_id = $1
            """,
            int(emotion_id),
        )
        return self._to_dict(row) if row else None

    async def create_intervention(self, data: Dict[str, Any]) -> Optional[int]:
        row = await self.pool.fetchrow(
            """
            insert into public.interventions (
              user_id,
              reason,
              message,
              status,
              message_type
            )
            values ($1, $2, $3, $4, $5)
            returning id
            """,
            data.get("user_id"),
            data.get("reason"),
            data.get("message"),
            data.get("status", "pending"),
            data.get("message_type"),
        )
        return row["id"] if row else None

    async def get_pending_interventions(self, user_id: str, limit: int = 1) -> List[Dict[str, Any]]:
        rows = await self.pool.fetch(
            """
            select *
            from public.interventions
            where user_id = $1
              and status = 'pending'
            order by created_at desc
            limit $2
            """,
            user_id,
            limit,
        )
        return [self._to_dict(row) for row in rows]

    async def update_intervention_status(self, intervention_id: int, status: str) -> bool:
        result = await self.pool.execute(
            """
            update public.interventions
            set status = $1
            where id = $2
            """,
            status,
            int(intervention_id),
        )
        return result.endswith("1")

    async def get_recent_interventions(
        self,
        user_id: str,
        hours: int = 24,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        rows = await self.pool.fetch(
            """
            select *
            from public.interventions
            where user_id = $1
              and created_at >= $2
            order by created_at desc
            limit $3
            """,
            user_id,
            cutoff,
            limit,
        )
        return [self._to_dict(row) for row in rows]

    async def count_today_interventions(self, user_id: str) -> int:
        today_start = datetime.now(timezone.utc).replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        return await self.pool.fetchval(
            """
            select count(*)::int
            from public.interventions
            where user_id = $1
              and created_at >= $2
            """,
            user_id,
            today_start,
        )

    async def get_last_intervention_time(self, user_id: str) -> Optional[datetime]:
        return await self.pool.fetchval(
            """
            select created_at
            from public.interventions
            where user_id = $1
            order by created_at desc
            limit 1
            """,
            user_id,
        )

    async def get_recent_emotions(
        self,
        user_id: str,
        days: int = 7,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        start_date = datetime.now(timezone.utc) - timedelta(days=days)
        rows = await self.pool.fetch(
            """
            select
              m.id,
              m.emotion_id,
              m.text,
              m.text_ciphertext,
              m.text_iv,
              m.created_at,
              m.user_id,
              ec.emotion
            from public.memories m
            left join public.emotion_categories ec
              on ec.emotion_id = m.emotion_id
            where m.user_id = $1
              and m.created_at >= $2
            order by m.created_at desc
            limit $3
            """,
            user_id,
            start_date,
            limit,
        )
        return [self._memory_row(row) for row in rows]

    async def get_days_since_last_record(self, user_id: str) -> Optional[int]:
        last_created_at = await self.pool.fetchval(
            """
            select created_at
            from public.memories
            where user_id = $1
            order by created_at desc
            limit 1
            """,
            user_id,
        )
        if last_created_at is None:
            return None
        return (datetime.now(last_created_at.tzinfo) - last_created_at).days

    async def get_consecutive_emotions(
        self,
        user_id: str,
        emotion_type: str = "negative",
        limit: int = 10,
    ) -> int:
        rows = await self.pool.fetch(
            """
            select ec.emotion
            from public.memories m
            left join public.emotion_categories ec
              on ec.emotion_id = m.emotion_id
            where m.user_id = $1
            order by m.created_at desc
            limit $2
            """,
            user_id,
            limit,
        )
        targets = EMOTION_CATEGORIES.get(emotion_type, [])
        if not targets:
            return 0

        count = 0
        for row in rows:
            emotion = (row["emotion"] or "").lower()
            if emotion in targets:
                count += 1
                continue
            break
        return count

    async def get_feedback_trend(self, user_id: str, limit: int = 5) -> Optional[float]:
        rows = await self.pool.fetch(
            """
            select feedback_score
            from public.interventions
            where user_id = $1
              and status in ('shown', 'interacted')
            order by created_at desc
            limit $2
            """,
            user_id,
            limit,
        )
        if not rows:
            return None
        scores = [row["feedback_score"] or 0 for row in rows]
        return sum(scores) / len(scores)

    async def calculate_feedback_score(self, intervention_id: int) -> int:
        rows = await self.pool.fetch(
            """
            select explicit_score
            from public.intervention_feedback
            where intervention_id = $1
            """,
            int(intervention_id),
        )
        return sum(row["explicit_score"] or 0 for row in rows)

    async def save_feedback_score(self, intervention_id: int, score: int) -> None:
        await self.pool.execute(
            """
            update public.interventions
            set feedback_score = $1
            where id = $2
            """,
            int(score),
            int(intervention_id),
        )
