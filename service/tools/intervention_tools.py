# tools/intervention_tools.py
"""
개입 이력 조회 도구들
"""
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta


logger = logging.getLogger(__name__)

DEFAULT_USER_ID = "default_user"


async def check_intervention_history(
    store,
    user_id: str = DEFAULT_USER_ID,
    hours: int = 24
) -> Dict[str, Any]:
    """최근 개입 이력 확인"""
    try:
        interventions = await store.get_recent_interventions(user_id, hours=hours)
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

    except Exception as e:
        logger.error(f"Error checking intervention history: {e}", exc_info=True)
        return {
            "count": 0,
            "last_intervention": None,
            "hours_since_last": None,
            "has_recent_intervention": False
        }


async def count_today_interventions(
    store,
    user_id: str = DEFAULT_USER_ID
) -> int:
    """오늘 생성된 개입 횟수"""
    try:
        count = await store.count_today_interventions(user_id)
        logger.info(f"Today's interventions for user {user_id}: {count}")
        return count
    except Exception as e:
        logger.error(f"Error counting today's interventions: {e}", exc_info=True)
        return 0


async def get_last_intervention_time(
    store,
    user_id: str = DEFAULT_USER_ID
) -> Optional[datetime]:
    """마지막 개입 시간"""
    try:
        return await store.get_last_intervention_time(user_id)
    except Exception as e:
        logger.error(f"Error getting last intervention time: {e}", exc_info=True)
        return None


async def get_intervention_acceptance_rate(
    store,
    user_id: str = DEFAULT_USER_ID,
    days: int = 30
) -> Dict[str, Any]:
    """개입 수용률 분석"""
    try:
        if hasattr(store, "get_intervention_acceptance_rate"):
            return await store.get_intervention_acceptance_rate(user_id, days)
        return {"total": 0, "responded": 0, "dismissed": 0, "acceptance_rate": 0}
    except Exception as e:
        logger.error(f"Error getting acceptance rate: {e}", exc_info=True)
        return {"total": 0, "responded": 0, "dismissed": 0, "acceptance_rate": 0}


async def should_intervene_based_on_frequency(
    store,
    user_id: str = DEFAULT_USER_ID,
    max_per_day: int = 2,
    min_hours_between: int = 4
) -> Dict[str, Any]:
    """빈도 기반 개입 가능 여부 판단"""
    try:
        today_count = await count_today_interventions(store, user_id)

        if today_count >= max_per_day:
            return {
                "should_intervene": False,
                "reason": "daily_limit_reached",
                "today_count": today_count,
                "hours_since_last": None
            }

        last_time = await get_last_intervention_time(store, user_id)
        hours_since = None

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

        return {
            "should_intervene": True,
            "reason": "ok",
            "today_count": today_count,
            "hours_since_last": round(hours_since, 2) if hours_since is not None else None
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
    store,
    user_id: str = DEFAULT_USER_ID
) -> Optional[float]:
    """마지막 개입 이후 경과 시간 (시간 단위)"""
    last_time = await get_last_intervention_time(store, user_id)

    if not last_time:
        return None

    now = datetime.now(last_time.tzinfo)
    hours = (now - last_time).total_seconds() / 3600

    return round(hours, 2)
