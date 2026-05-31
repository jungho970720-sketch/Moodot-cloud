"""
Intervention 데이터 접근 레이어
"""
import logging
from typing import Optional, List
from datetime import datetime, timedelta

from .intervention import Intervention, InterventionStatus

logger = logging.getLogger(__name__)


class InterventionRepository:
    """Intervention 데이터베이스 접근"""

    def __init__(self, store):
        self.store = store

    async def create(self, intervention: Intervention) -> Optional[str]:
        """새 개입 생성"""
        try:
            data = intervention.to_db_dict()
            logger.info(f"💾 Intervention 저장: {intervention.reason}")

            intervention_id = await self.store.create_intervention(data)
            if intervention_id:
                logger.info(f"✅ 저장 완료: {intervention_id}")
                return intervention_id

            logger.error("❌ 저장 실패: 응답 데이터 없음")
            return None

        except Exception as e:
            logger.error(f"❌ 저장 실패: {e}", exc_info=True)
            return None

    async def get_pending(self, user_id: str, limit: int = 1) -> List[Intervention]:
        """pending 상태 개입 조회"""
        try:
            rows = await self.store.get_pending_interventions(user_id, limit)
            interventions = [Intervention.from_db_dict(item) for item in rows]
            logger.debug(f"Pending 조회: {len(interventions)}개")
            return interventions
        except Exception as e:
            logger.error(f"❌ Pending 조회 실패: {e}")
            return []

    async def update_status(
        self,
        intervention_id: str,
        status: InterventionStatus
    ) -> bool:
        """상태 업데이트"""
        try:
            success = await self.store.update_intervention_status(
                intervention_id,
                status.value,
            )
            if success:
                logger.info(f"✅ 상태 업데이트: {intervention_id} → {status.value}")
            else:
                logger.warning(f"⚠️ 상태 업데이트 실패: {intervention_id}")
            return success
        except Exception as e:
            logger.error(f"❌ 상태 업데이트 실패: {e}")
            return False

    async def count_today(self, user_id: str) -> int:
        """오늘 생성된 개입 횟수"""
        try:
            count = await self.store.count_today_interventions(user_id)
            logger.debug(f"오늘 개입: {count}회")
            return count
        except Exception as e:
            logger.error(f"❌ 개입 횟수 조회 실패: {e}")
            return 0

    async def get_recent(
        self,
        user_id: str,
        hours: int = 24,
        limit: int = 10
    ) -> List[Intervention]:
        """최근 개입 이력"""
        try:
            rows = await self.store.get_recent_interventions(user_id, hours, limit)
            return [Intervention.from_db_dict(item) for item in rows]
        except Exception as e:
            logger.error(f"❌ 최근 개입 조회 실패: {e}")
            return []
