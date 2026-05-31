# tools/intervention_tools.py
"""
개입 이력 조회 도구들
"""
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta


logger = logging.getLogger(__name__)

# ✅ MVP용 기본 사용자 ID
DEFAULT_USER_ID = "default_user"


async def check_intervention_history(
    supabase,
    user_id: str = DEFAULT_USER_ID,  # ✅ 기본값 추가
    hours: int = 24
) -> Dict[str, Any]:
    """
    최근 개입 이력 확인
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID (기본값: default_user)
        hours: 조회 기간 (시간)
    
    Returns:
        개입 이력 정보
        {
            "count": 2,
            "last_intervention": "2024-01-20T14:30:00",
            "hours_since_last": 2.5,
            "has_recent_intervention": True
        }
    
    Example:
        >>> # MVP: user_id 생략 가능
        >>> history = check_intervention_history(supabase, hours=24)
        >>> history['count']
        2
        
        >>> # 나중에 로그인 구현 후
        >>> history = check_intervention_history(supabase, "user123", hours=24)
    """
    try:
        if hasattr(supabase, "get_recent_interventions"):
            interventions = await supabase.get_recent_interventions(user_id, hours=hours)
            count = len(interventions)
            last_intervention = None
            hours_since_last = None

            if interventions:
                last_created = interventions[0]['created_at']
                last_intervention = last_created
                last_dt = last_created if isinstance(last_created, datetime) else datetime.fromisoformat(str(last_created).replace('Z', '+00:00'))
                now_dt = datetime.now(last_dt.tzinfo)
                hours_since_last = (now_dt - last_dt).total_seconds() / 3600

            return {
                "count": count,
                "last_intervention": last_intervention.isoformat() if hasattr(last_intervention, "isoformat") else last_intervention,
                "hours_since_last": round(hours_since_last, 2) if hours_since_last else None,
                "has_recent_intervention": count > 0
            }

        # N시간 전 시간 계산
        cutoff_time = datetime.now() - timedelta(hours=hours)
        cutoff_str = cutoff_time.isoformat()
        
        logger.debug(f"Checking intervention history: user_id={user_id}, hours={hours}")
        
        # 최근 개입 조회
        result = await supabase.table('interventions')\
            .select('id, created_at')\
            .eq('user_id', user_id)\
            .gte('created_at', cutoff_str)\
            .order('created_at', desc=True)\
            .execute()
        
        interventions = result.data if hasattr(result, 'data') else []
        count = len(interventions)
        
        # 마지막 개입 시간 계산
        last_intervention = None
        hours_since_last = None
        
        if interventions:
            last_created = interventions[0]['created_at']
            last_intervention = last_created
            
            last_dt = datetime.fromisoformat(last_created.replace('Z', '+00:00'))
            now_dt = datetime.now(last_dt.tzinfo)
            hours_since_last = (now_dt - last_dt).total_seconds() / 3600
        
        history = {
            "count": count,
            "last_intervention": last_intervention,
            "hours_since_last": round(hours_since_last, 2) if hours_since_last else None,
            "has_recent_intervention": count > 0
        }
        
        logger.info(f"Intervention history for user {user_id}: {history}")  # ✅ info로 변경
        return history
        
    except Exception as e:
        logger.error(f"Error checking intervention history: {e}", exc_info=True)  # ✅ exc_info 추가
        return {
            "count": 0,
            "last_intervention": None,
            "hours_since_last": None,
            "has_recent_intervention": False
        }


async def count_today_interventions(
    supabase,
    user_id: str = DEFAULT_USER_ID  # ✅ 기본값 추가
) -> int:
    """
    오늘 생성된 개입 횟수
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID (기본값: default_user)
    
    Returns:
        오늘 개입 횟수
    
    Example:
        >>> # MVP: user_id 생략 가능
        >>> count = count_today_interventions(supabase)
        >>> count
        2
    """
    try:
        if hasattr(supabase, "count_today_interventions"):
            count = await supabase.count_today_interventions(user_id)
            logger.info(f"Today's interventions for user {user_id}: {count}")
            return count

        # 오늘 00:00:00
        today_start = datetime.now().replace(
            hour=0, minute=0, second=0, microsecond=0
        ).isoformat()
        
        result = await supabase.table('interventions')\
            .select('id', count='exact')\
            .eq('user_id', user_id)\
            .gte('created_at', today_start)\
            .execute()
        
        count = result.count if hasattr(result, 'count') else 0
        
        logger.info(f"Today's interventions for user {user_id}: {count}")  # ✅ info + user_id
        return count
        
    except Exception as e:
        logger.error(f"Error counting today's interventions: {e}", exc_info=True)
        return 0


async def get_last_intervention_time(
    supabase,
    user_id: str = DEFAULT_USER_ID  # ✅ 기본값 추가
) -> Optional[datetime]:
    """
    마지막 개입 시간
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID (기본값: default_user)
    
    Returns:
        마지막 개입 시간 (없으면 None)
    
    Example:
        >>> last_time = get_last_intervention_time(supabase)
        >>> last_time
        datetime(2024, 1, 20, 14, 30, 0)
    """
    try:
        if hasattr(supabase, "get_last_intervention_time"):
            last_time = await supabase.get_last_intervention_time(user_id)
            logger.debug(f"Last intervention time for user {user_id}: {last_time}")
            return last_time

        result = await supabase.table('interventions')\
            .select('created_at')\
            .eq('user_id', user_id)\
            .order('created_at', desc=True)\
            .limit(1)\
            .execute()
        
        if hasattr(result, 'data') and result.data:
            created_at_str = result.data[0]['created_at']
            last_time = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
            
            logger.debug(f"Last intervention time for user {user_id}: {last_time}")
            return last_time
        
        logger.debug(f"No previous interventions found for user: {user_id}")
        return None
        
    except Exception as e:
        logger.error(f"Error getting last intervention time: {e}", exc_info=True)
        return None


async def get_intervention_acceptance_rate(
    supabase,
    user_id: str = DEFAULT_USER_ID,  # ✅ 기본값 추가
    days: int = 30
) -> Dict[str, Any]:
    """
    개입 수용률 분석
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID (기본값: default_user)
        days: 분석 기간 (일)
    
    Returns:
        수용률 정보
        {
            "total": 10,
            "responded": 6,      # ✅ 'accepted' → 'responded'
            "dismissed": 4,
            "acceptance_rate": 0.6
        }
    
    Example:
        >>> rate = get_intervention_acceptance_rate(supabase)
        >>> rate['acceptance_rate']
        0.6
        
    Note:
        - status 기준:
            - 'responded': 사용자가 응답함
            - 'dismissed': 사용자가 무시함
            - 'shown': 표시만 됨 (아직 반응 없음)
    """
    try:
        start_date = (datetime.now() - timedelta(days=days)).isoformat()
        
        # ✅ 현재 스키마에 맞게 수정 (status 기준)
        result = await supabase.table('interventions')\
            .select('status')\
            .eq('user_id', user_id)\
            .gte('created_at', start_date)\
            .in_('status', ['responded', 'dismissed'])\
            .execute()
        
        if not hasattr(result, 'data') or not result.data:
            return {
                "total": 0,
                "responded": 0,
                "dismissed": 0,
                "acceptance_rate": 0
            }
        
        interventions = result.data
        total = len(interventions)
        
        # ✅ status 기준으로 카운트
        responded = sum(1 for i in interventions if i.get('status') == 'responded')
        dismissed = sum(1 for i in interventions if i.get('status') == 'dismissed')
        
        acceptance_rate = responded / total if total > 0 else 0
        
        stats = {
            "total": total,
            "responded": responded,  # ✅ 'accepted' → 'responded'
            "dismissed": dismissed,
            "acceptance_rate": round(acceptance_rate, 2)
        }
        
        logger.info(f"Acceptance rate for user {user_id} (last {days} days): {stats}")
        return stats
        
    except Exception as e:
        logger.error(f"Error getting acceptance rate: {e}", exc_info=True)
        return {
            "total": 0,
            "responded": 0,
            "dismissed": 0,
            "acceptance_rate": 0
        }


async def should_intervene_based_on_frequency(
    supabase,
    user_id: str = DEFAULT_USER_ID,
    max_per_day: int = 2,  # ✅ 설정 가능하도록
    min_hours_between: int = 4
) -> Dict[str, Any]:
    """
    빈도 기반 개입 가능 여부 판단
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
        max_per_day: 하루 최대 개입 횟수
        min_hours_between: 최소 간격 (시간)
    
    Returns:
        판단 결과
        {
            "should_intervene": False,
            "reason": "daily_limit_reached",
            "today_count": 2,
            "hours_since_last": 1.5
        }
    
    Example:
        >>> result = should_intervene_based_on_frequency(supabase)
        >>> result['should_intervene']
        False
        >>> result['reason']
        'daily_limit_reached'
    """
    try:
        # 1. 오늘 개입 횟수 체크
        today_count = await count_today_interventions(supabase, user_id)
        
        if today_count >= max_per_day:
            return {
                "should_intervene": False,
                "reason": "daily_limit_reached",
                "today_count": today_count,
                "hours_since_last": None
            }
        
        # 2. 마지막 개입 시간 체크
        last_time = await get_last_intervention_time(supabase, user_id)
        
        if last_time:
            now = datetime.now(last_time.tzinfo)
            hours_since = (now - last_time).total_seconds() / 3600
            
            if hours_since < min_hours_between:
                return {
                    "should_intervene": False,
                    "reason": "too_soon",
                    "today_count": today_count,
                    "hours_since_last": round(hours_since, 2)
                }
        
        # 3. 개입 가능
        return {
            "should_intervene": True,
            "reason": "ok",
            "today_count": today_count,
            "hours_since_last": round(hours_since, 2) if last_time else None
        }
        
    except Exception as e:
        logger.error(f"Error checking intervention frequency: {e}", exc_info=True)
        return {
            "should_intervene": False,
            "reason": "error",
            "today_count": 0,
            "hours_since_last": None
        }
    
async def get_hours_since_last_intervention(
    supabase,
    user_id: str = DEFAULT_USER_ID
) -> Optional[float]:
    """
    마지막 개입 이후 경과 시간 (시간 단위)
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
    
    Returns:
        경과 시간 (시간 단위), 개입 없으면 None
    
    Example:
        >>> hours = await get_hours_since_last_intervention(supabase)
        >>> hours
        5.5
    """
    last_time = await get_last_intervention_time(supabase, user_id)
    
    if not last_time:
        return None
    
    now = datetime.now(last_time.tzinfo)
    hours = (now - last_time).total_seconds() / 3600
    
    return round(hours, 2)
