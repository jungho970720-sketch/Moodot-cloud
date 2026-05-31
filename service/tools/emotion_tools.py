# tools/emotion_tools.py
"""
감정 데이터 조회 도구들
"""
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from security.memory_crypto import decrypt_memory_text


logger = logging.getLogger(__name__)

# ✅ MVP용 기본 사용자 ID
DEFAULT_USER_ID = "default_user"

# ✅ 현재 지원하는 4가지 감정 분류
EMOTION_CATEGORIES = {
    'negative': ['bad', 'sad'],
    'positive': ['good'],
    'neutral': ['calm']
}


async def get_recent_emotions(
    supabase,
    user_id: str = DEFAULT_USER_ID,
    days: int = 7,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    최근 N일간의 감정 기록 조회
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
        days: 조회할 일수
        limit: 최대 조회 개수
    
    Returns:
        감정 기록 리스트
    """
    try:
        if hasattr(supabase, "get_recent_emotions"):
            return await supabase.get_recent_emotions(user_id, days=days, limit=limit)

        start_date = datetime.now() - timedelta(days=days)
        start_date_str = start_date.isoformat()
        
        logger.debug(f"Querying emotions: user_id={user_id}, days={days}")
        
        result = await supabase.table('memories')\
            .select('''
                id,
                emotion_id,
                text,
                text_ciphertext,
                text_iv,
                created_at,
                user_id,
                emotion_categories(emotion)
            ''')\
            .eq('user_id', user_id)\
            .gte('created_at', start_date_str)\
            .order('created_at', desc=True)\
            .limit(limit)\
            .execute()
        
        if hasattr(result, 'data') and result.data:
            emotions = []
            for item in result.data:
                try:
                    plain_text = decrypt_memory_text(
                        item.get('text_ciphertext'),
                        item.get('text_iv'),
                        item.get('text'),
                    )
                except Exception as e:
                    logger.warning(f"텍스트 복호화 실패 (id={item['id']}): {e}")
                    plain_text = item.get('text', '')

                emotion_data = {
                    'id': item['id'],
                    'emotion_id': item['emotion_id'],
                    'emotion_name': item['emotion_categories']['emotion'] if item.get('emotion_categories') else 'Unknown',
                    'text': plain_text or '',
                    'created_at': item['created_at'],
                    'user_id': item.get('user_id')
                }
                emotions.append(emotion_data)
            
            logger.debug(f"Found {len(emotions)} emotions for user: {user_id}")
            return emotions
        
        logger.debug(f"No emotions found for user: {user_id}")
        return []
        
    except Exception as e:
        logger.error(f"Error getting recent emotions: {e}", exc_info=True)
        return []


async def get_days_since_last_record(
    supabase,
    user_id: str = DEFAULT_USER_ID
) -> Optional[int]:
    """
    마지막 감정 기록 이후 경과 일수
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
    
    Returns:
        경과 일수 (기록 없으면 None)
    """
    try:
        if hasattr(supabase, "get_days_since_last_record"):
            return await supabase.get_days_since_last_record(user_id)

        result = await supabase.table('memories')\
            .select('created_at')\
            .eq('user_id', user_id)\
            .order('created_at', desc=True)\
            .limit(1)\
            .execute()
        
        if hasattr(result, 'data') and result.data:
            last_record = result.data[0]
            last_date = datetime.fromisoformat(
                last_record['created_at'].replace('Z', '+00:00')
            )
            
            days_since = (datetime.now(last_date.tzinfo) - last_date).days
            
            logger.debug(f"Days since last record: {days_since} (user: {user_id})")
            return days_since
        
        logger.debug(f"No records found for user: {user_id}")
        return None
        
    except Exception as e:
        logger.error(f"Error getting days since last record: {e}")
        return None


async def get_consecutive_emotions(
    supabase,
    user_id: str = DEFAULT_USER_ID,
    emotion_type: str = "negative",
    limit: int = 10
) -> int:
    """
    연속된 같은 유형의 감정 개수
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
        emotion_type: 감정 유형
            - "negative": 부정 감정 (bad, sad)
            - "positive": 긍정 감정 (good)
            - "neutral": 중립 (calm)
        limit: 최대 확인 개수
    
    Returns:
        연속된 감정 개수
    """
    try:
        if hasattr(supabase, "get_consecutive_emotions"):
            return await supabase.get_consecutive_emotions(user_id, emotion_type, limit)

        result = await supabase.table('memories')\
            .select('''
                id,
                emotion_id,
                emotion_categories(emotion)
            ''')\
            .eq('user_id', user_id)\
            .order('created_at', desc=True)\
            .limit(limit)\
            .execute()
        
        if not hasattr(result, 'data') or not result.data:
            logger.debug(f"No emotions found for user: {user_id}")
            return 0
        
        emotions = result.data
        consecutive_count = 0
        
        # 해당 유형의 감정 리스트
        target_emotions = EMOTION_CATEGORIES.get(emotion_type, [])
        
        if not target_emotions:
            logger.warning(f"Unknown emotion_type: {emotion_type}")
            return 0
        
        # 연속 카운트
        for item in emotions:
            emotion_cat = item.get('emotion_categories')
            
            if not emotion_cat:
                logger.debug(f"No emotion_categories for item: {item.get('id')}")
                break
            
            emotion_name = emotion_cat.get('emotion', '').lower()
            
            if emotion_name in target_emotions:
                consecutive_count += 1
                logger.debug(f"Match: {emotion_name} is {emotion_type}")
            else:
                logger.debug(f"Break: {emotion_name} is not {emotion_type}")
                break
        
        logger.info(f"Consecutive {emotion_type} emotions: {consecutive_count} (user: {user_id})")
        return consecutive_count
        
    except Exception as e:
        logger.error(f"Error getting consecutive emotions: {e}", exc_info=True)
        return 0


async def get_emotion_statistics(
    supabase,
    user_id: str = DEFAULT_USER_ID,
    days: int = 7
) -> Dict[str, Any]:
    """
    감정 통계 정보
    
    Args:
        supabase: Supabase 클라이언트
        user_id: 사용자 ID
        days: 통계 기간 (일)
    
    Returns:
        통계 딕셔너리
    """
    try:
        emotions = await get_recent_emotions(supabase, user_id, days=days)
        
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
    supabase,
    emotion_id: int
) -> Optional[Dict[str, Any]]:
    """
    emotion_id로 감정 정보 조회
    
    Args:
        supabase: Supabase 클라이언트
        emotion_id: 감정 카테고리 ID
    
    Returns:
        감정 정보 딕셔너리
    """
    try:
        if hasattr(supabase, "get_emotion_by_id"):
            return await supabase.get_emotion_by_id(emotion_id)

        result = await supabase.table('emotion_categories')\
            .select('*')\
            .eq('emotion_id', emotion_id)\
            .single()\
            .execute()
        
        if hasattr(result, 'data') and result.data:
            return result.data
        
        return None
        
    except Exception as e:
        logger.error(f"Error getting emotion by id: {e}")
        return None
