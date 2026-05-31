# tools/emotion_tools.py
"""
감정 데이터 조회 도구들
"""
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from security.memory_crypto import decrypt_memory_text


logger = logging.getLogger(__name__)

DEFAULT_USER_ID = "default_user"

EMOTION_CATEGORIES = {
    'negative': ['bad', 'sad'],
    'positive': ['good'],
    'neutral': ['calm']
}


async def get_recent_emotions(
    store,
    user_id: str = DEFAULT_USER_ID,
    days: int = 7,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """최근 N일간의 감정 기록 조회"""
    try:
        return await store.get_recent_emotions(user_id, days=days, limit=limit)
    except Exception as e:
        logger.error(f"Error getting recent emotions: {e}", exc_info=True)
        return []


async def get_days_since_last_record(
    store,
    user_id: str = DEFAULT_USER_ID
) -> Optional[int]:
    """마지막 감정 기록 이후 경과 일수"""
    try:
        return await store.get_days_since_last_record(user_id)
    except Exception as e:
        logger.error(f"Error getting days since last record: {e}")
        return None


async def get_consecutive_emotions(
    store,
    user_id: str = DEFAULT_USER_ID,
    emotion_type: str = "negative",
    limit: int = 10
) -> int:
    """연속된 같은 유형의 감정 개수"""
    try:
        return await store.get_consecutive_emotions(user_id, emotion_type, limit)
    except Exception as e:
        logger.error(f"Error getting consecutive emotions: {e}", exc_info=True)
        return 0


async def get_emotion_statistics(
    store,
    user_id: str = DEFAULT_USER_ID,
    days: int = 7
) -> Dict[str, Any]:
    """감정 통계 정보"""
    try:
        emotions = await get_recent_emotions(store, user_id, days=days)

        if not emotions:
            return {
                "total_count": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
                "most_frequent_emotion": None,
                "emotion_distribution": {}
            }

        total = len(emotions)
        positive = sum(1 for e in emotions if e['emotion_name'].lower() == 'good')
        negative = sum(1 for e in emotions if e['emotion_name'].lower() in ['bad', 'sad'])
        neutral = sum(1 for e in emotions if e['emotion_name'].lower() == 'calm')

        from collections import Counter
        emotion_counts = Counter(e['emotion_name'] for e in emotions)
        most_frequent = emotion_counts.most_common(1)[0][0] if emotion_counts else None

        stats = {
            "total_count": total,
            "positive_count": positive,
            "negative_count": negative,
            "neutral_count": neutral,
            "most_frequent_emotion": most_frequent,
            "emotion_distribution": dict(emotion_counts)
        }

        logger.info(f"Emotion statistics for user {user_id}: {stats}")
        return stats

    except Exception as e:
        logger.error(f"Error getting emotion statistics: {e}", exc_info=True)
        return {
            "total_count": 0,
            "positive_count": 0,
            "negative_count": 0,
            "neutral_count": 0,
            "most_frequent_emotion": None,
            "emotion_distribution": {}
        }


async def get_emotion_by_id(
    store,
    emotion_id: int
) -> Optional[Dict[str, Any]]:
    """emotion_id로 감정 정보 조회"""
    try:
        return await store.get_emotion_by_id(emotion_id)
    except Exception as e:
        logger.error(f"Error getting emotion by id: {e}")
        return None
