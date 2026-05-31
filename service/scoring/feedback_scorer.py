"""
피드백 점수 계산
"""
import logging

logger = logging.getLogger(__name__)


async def calculate_score(supabase, intervention_id: str) -> int:
    """
    intervention에 달린 모든 피드백 신호를 합산해 총점 반환.

    현재 신호: explicit_score (+2 / -2)
    추후 추가 예정: implicit_score, response_score 등

    분류 기준:
        +3 이상 → 좋음
        0 ~ +2  → 보통
        0 미만  → 별로
    """
    try:
        if hasattr(supabase, "calculate_feedback_score"):
            score = await supabase.calculate_feedback_score(intervention_id)
            logger.debug(f"점수 계산 완료: intervention={intervention_id}, score={score}")
            return score

        result = await supabase.table("intervention_feedback") \
            .select("explicit_score") \
            .eq("intervention_id", intervention_id) \
            .execute()

        rows = result.data if hasattr(result, "data") and result.data else []
        total = sum(row.get("explicit_score") or 0 for row in rows)
        logger.debug(f"점수 계산 완료: intervention={intervention_id}, score={total}")
        return total

    except Exception as e:
        logger.error(f"❌ 점수 계산 실패: {e}")
        return 0


async def save_score(supabase, intervention_id: str, score: int) -> None:
    """총점을 interventions.feedback_score에 저장"""
    try:
        if hasattr(supabase, "save_feedback_score"):
            await supabase.save_feedback_score(intervention_id, score)
            logger.info(f"✅ feedback_score 저장: intervention={intervention_id}, score={score}")
            return

        await supabase.table("interventions") \
            .update({"feedback_score": score}) \
            .eq("id", intervention_id) \
            .execute()
        logger.info(f"✅ feedback_score 저장: intervention={intervention_id}, score={score}")
    except Exception as e:
        logger.error(f"❌ feedback_score 저장 실패: {e}")
