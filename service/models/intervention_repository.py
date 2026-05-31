"""
Intervention 데이터 접근 레이어 (최소 버전)
"""
import logging
from typing import Optional, List
from datetime import datetime, timedelta

from .intervention import Intervention, InterventionStatus

logger = logging.getLogger(__name__)


class InterventionRepository:


    """Intervention 데이터베이스 접근"""
    def __init__(self, supabase):
        self.supabase = supabase
        self.table = 'interventions'
    

    async def create(self, intervention: Intervention) -> Optional[str]:
        """
        새 개입 생성
        
        Args:
            intervention: Intervention 객체
            
        Returns:
            생성된 ID (성공 시)
        """
        try:
            data = intervention.to_db_dict()
            
            logger.info(f"💾 Intervention 저장: {intervention.reason}")

            if hasattr(self.supabase, "create_intervention"):
                intervention_id = await self.supabase.create_intervention(data)
                if intervention_id:
                    logger.info(f"✅ 저장 완료: {intervention_id}")
                    return intervention_id
                logger.error("❌ 저장 실패: 응답 데이터 없음")
                return None
            
            result = await self.supabase.table(self.table)\
                .insert(data)\
                .execute()
            
            if hasattr(result, 'data') and result.data:
                intervention_id = result.data[0]['id']
                logger.info(f"✅ 저장 완료: {intervention_id}")
                return intervention_id
            
            logger.error("❌ 저장 실패: 응답 데이터 없음")
            return None
            
        except Exception as e:
            logger.error(f"❌ 저장 실패: {e}", exc_info=True)
            return None
    

    async def get_pending(self, user_id: str, limit: int = 1) -> List[Intervention]:
    # async def get_pending(self, limit: int = 1) -> List[Intervention]:    
        """
        pending 상태 개입 조회
        
        Args:
            user_id: 사용자 ID
            limit: 최대 개수
            
        Returns:
            Intervention 리스트
        """
        try:
            if hasattr(self.supabase, "get_pending_interventions"):
                rows = await self.supabase.get_pending_interventions(user_id, limit)
                interventions = [Intervention.from_db_dict(item) for item in rows]
                logger.debug(f"Pending 조회: {len(interventions)}개")
                return interventions

            result = await self.supabase.table(self.table)\
                .select('*')\
                .eq('user_id', user_id)\
                .eq('status', InterventionStatus.PENDING.value)\
                .order('created_at', desc=True)\
                .limit(limit)\
                .execute()
            
            if hasattr(result, 'data') and result.data:
                interventions = [
                    Intervention.from_db_dict(item) 
                    for item in result.data
                ]
                logger.debug(f"Pending 조회: {len(interventions)}개")
                return interventions
            
            return []
            
        except Exception as e:
            logger.error(f"❌ Pending 조회 실패: {e}")
            return []
    

    async def update_status(
        self, 
        intervention_id: str, 
        status: InterventionStatus
    ) -> bool:
        """
        상태 업데이트
        
        Args:
            intervention_id: 개입 ID
            status: 새 상태
            
        Returns:
            성공 여부
        """
        try:
            if hasattr(self.supabase, "update_intervention_status"):
                success = await self.supabase.update_intervention_status(
                    intervention_id,
                    status.value,
                )
                if success:
                    logger.info(f"✅ 상태 업데이트: {intervention_id} → {status.value}")
                else:
                    logger.warning(f"⚠️ 상태 업데이트 실패: {intervention_id}")
                return success

            result = await self.supabase.table(self.table)\
                .update({'status': status.value})\
                .eq('id', intervention_id)\
                .execute()
            
            if hasattr(result, 'data') and result.data:
                logger.info(f"✅ 상태 업데이트: {intervention_id} → {status.value}")
                return True
            
            logger.warning(f"⚠️ 상태 업데이트 실패: {intervention_id}")
            return False
            
        except Exception as e:
            logger.error(f"❌ 상태 업데이트 실패: {e}")
            return False
    

    async def count_today(self, user_id: str) -> int:
        """
        오늘 생성된 개입 횟수
        
        Args:
            user_id: 사용자 ID
            
        Returns:
            개입 횟수
        """
        try:
            if hasattr(self.supabase, "count_today_interventions"):
                count = await self.supabase.count_today_interventions(user_id)
                logger.debug(f"오늘 개입: {count}회")
                return count

            today_start = datetime.now().replace(
                hour=0, minute=0, second=0, microsecond=0
            ).isoformat()
            
            result = await self.supabase.table(self.table)\
                .eq('user_id', user_id)\
                .select('id', count='exact')\
                .gte('created_at', today_start)\
                .execute()
            
            count = result.count if hasattr(result, 'count') else 0
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
        """
        최근 개입 이력
        
        Args:
            user_id: 사용자 ID
            hours: 조회 기간 (시간)
            limit: 최대 개수
            
        Returns:
            Intervention 리스트
        """
        try:
            if hasattr(self.supabase, "get_recent_interventions"):
                rows = await self.supabase.get_recent_interventions(user_id, hours, limit)
                return [Intervention.from_db_dict(item) for item in rows]

            cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
            
            result = await self.supabase.table(self.table)\
                .select('*')\
                .eq('user_id', user_id)\
                .gte('created_at', cutoff)\
                .order('created_at', desc=True)\
                .limit(limit)\
                .execute()
            
            if hasattr(result, 'data') and result.data:
                return [
                    Intervention.from_db_dict(item) 
                    for item in result.data
                ]
            
            return []
            
        except Exception as e:
            logger.error(f"❌ 최근 개입 조회 실패: {e}")
            return []
