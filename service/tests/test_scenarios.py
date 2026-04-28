"""
신규 기능 시나리오 테스트
────────────────────────
실행: python tests/test_scenarios.py
pytest: pytest tests/test_scenarios.py -v

커버리지:
  - LLM 출력 PII 감지 → 재생성 → fallback
  - 검증 실패(길이·문장수) → 재생성 → fallback
  - 재생성 시 retry_reason 힌트 프롬프트 포함 여부
  - 피드백 트렌드: shown 후 미응답 → 0점 반영
  - 피드백 트렌드: pending 상태 제외
"""
import asyncio
import sys
from pathlib import Path
from typing import Tuple
from unittest.mock import AsyncMock, MagicMock
import pytest

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from generators.message_generator import MessageGenerator
from config.base_llm import BaseLLMProvider
from scoring.behavior_adjuster import get_feedback_trend


# ══════════════════════════════════════════════════════════════════════════════
# Mock 헬퍼
# ══════════════════════════════════════════════════════════════════════════════

class SequentialMockLLM(BaseLLMProvider):
    """호출 순서대로 응답을 반환하는 Mock. 마지막 응답을 소진 후 반복."""

    def __init__(self, responses: list[str]):
        self._responses = responses
        self._call_count = 0
        self.prompts: list[str] = []

    @property
    def model_name(self) -> str:
        return "sequential-mock"

    def generate(self, prompt: str) -> Tuple[str, dict]:
        self.prompts.append(prompt)
        text = self._responses[min(self._call_count, len(self._responses) - 1)]
        self._call_count += 1
        usage = {"total_tokens": 10, "total_cost": 0.0}
        return text, usage


_results: list[dict] = []


def log_result(name: str, passed: bool, issues: str = ""):
    _results.append({"name": name, "passed": passed, "issues": issues})
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{'='*60}")
    print(f"[{name}]")
    print(f"판단: {status}")
    if issues:
        print(f"문제점: {issues}")


# ══════════════════════════════════════════════════════════════════════════════
# 1. PII 재생성 시나리오
# ══════════════════════════════════════════════════════════════════════════════

def test_pii_retry():
    print("\n" + "█"*60)
    print("  1. PII 재생성 시나리오")
    print("█"*60)

    ctx = {"days_since_last_record": 3, "recent_emotions": []}

    # 1-1. PII 포함 → 재생성 성공
    llm = SequentialMockLLM([
        "010-1234-5678로 연락해봐.",   # PII 포함 → 재생성
        "요즘 잘 지내고 있어?",         # 통과
    ])
    gen = MessageGenerator(llm)
    msg, meta = gen.generate_with_validation("no_recent_record", ctx)

    passed = (
        "010-1234-5678" not in msg
        and llm._call_count == 2
        and meta.get("validation_fallback") is not True
    )
    log_result("1-1. PII 포함 → 재생성 후 통과", passed,
               f"call_count={llm._call_count}, msg={msg!r}" if not passed else "")

    # 1-2. PII 계속 포함 → 재시도 소진 → fallback
    llm2 = SequentialMockLLM(["010-1234-5678로 연락해봐."])  # 항상 PII
    gen2 = MessageGenerator(llm2)
    msg2, meta2 = gen2.generate_with_validation("no_recent_record", ctx)

    passed = (
        "010-1234-5678" not in msg2
        and meta2.get("validation_fallback") is True
    )
    log_result("1-2. PII 계속 포함 → 재시도 소진 → fallback", passed,
               f"msg={msg2!r}, meta={meta2}" if not passed else "")

    # 1-3. 재생성 시 프롬프트에 PII 힌트 포함
    llm3 = SequentialMockLLM([
        "010-1234-5678로 연락해봐.",
        "오랜만이야, 요즘 어때?",
    ])
    gen3 = MessageGenerator(llm3)
    gen3.generate_with_validation("no_recent_record", ctx)

    retry_prompt = llm3.prompts[1] if len(llm3.prompts) > 1 else ""
    passed = "개인정보" in retry_prompt or "재작성" in retry_prompt
    log_result("1-3. 재생성 프롬프트에 PII 힌트 포함", passed,
               "retry 프롬프트에 힌트 없음" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 2. 검증 실패 재생성 시나리오
# ══════════════════════════════════════════════════════════════════════════════

def test_validation_retry():
    print("\n" + "█"*60)
    print("  2. 검증 실패 재생성 시나리오")
    print("█"*60)

    ctx = {"consecutive_negative": 3, "recent_emotions": [
        {"emotion_name": "bad", "text": ""},
        {"emotion_name": "bad", "text": ""},
        {"emotion_name": "bad", "text": ""},
    ]}

    # 2-1. 길이 초과 → 재생성 성공
    long_msg = "오늘도 많이 힘들었지만 그래도 괜찮아 힘내자 화이팅 잘 될 거야 걱정하지 마 너는 잘 하고 있어 포기하지 마."
    llm = SequentialMockLLM([long_msg, "요즘 많이 힘들지?"])
    gen = MessageGenerator(llm)
    msg, meta = gen.generate_with_validation("negative_pattern", ctx)

    passed = len(msg) <= 100 and llm._call_count == 2
    log_result("2-1. 길이 초과 → 재생성 후 통과", passed,
               f"len={len(msg)}, call_count={llm._call_count}" if not passed else "")

    # 2-2. 문장 수 초과 → 재생성 후 fallback
    two_sentence = "요즘 많이 힘들지? 나는 네 편이야."  # ? + 야. = 2 문장 종결
    llm2 = SequentialMockLLM([two_sentence])
    gen2 = MessageGenerator(llm2)
    msg2, meta2 = gen2.generate_with_validation("negative_pattern", ctx)

    passed = meta2.get("validation_fallback") is True
    log_result("2-2. 문장 수 초과 계속 → fallback", passed,
               f"meta={meta2}" if not passed else "")

    # 2-3. 금지어 → 재생성 시 프롬프트에 힌트 포함
    llm3 = SequentialMockLLM([
        "힘들면 병원에 가보는 게 좋아.",
        "요즘 많이 힘들지?",
    ])
    gen3 = MessageGenerator(llm3)
    gen3.generate_with_validation("negative_pattern", ctx)

    retry_prompt = llm3.prompts[1] if len(llm3.prompts) > 1 else ""
    passed = "의료" in retry_prompt or "재작성" in retry_prompt
    log_result("2-3. 금지어 재생성 프롬프트에 힌트 포함", passed,
               "retry 프롬프트에 힌트 없음" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 3. 피드백 트렌드 시나리오
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_feedback_trend():
    print("\n" + "█"*60)
    print("  3. 피드백 트렌드 시나리오")
    print("█"*60)

    # 3-1. shown이지만 피드백 없음 → 0점으로 계산
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value \
        .eq.return_value.in_.return_value \
        .order.return_value.limit.return_value \
        .execute = AsyncMock(return_value=MagicMock(data=[
            {"feedback_score": None},   # shown, 피드백 없음 → 0
            {"feedback_score": None},   # shown, 피드백 없음 → 0
            {"feedback_score": 2},      # 긍정 피드백
        ]))

    avg = await get_feedback_trend(mock_supabase, "user1")
    expected = (0 + 0 + 2) / 3
    passed = avg is not None and abs(avg - expected) < 0.01
    log_result(
        f"3-1. shown 무응답 2개(0점) + 긍정 1개(+2) → avg={expected:.2f}",
        passed,
        f"실제 avg={avg}" if not passed else "",
    )

    # 3-2. 모두 피드백 없음 → 평균 0
    mock_supabase2 = MagicMock()
    mock_supabase2.table.return_value.select.return_value \
        .eq.return_value.in_.return_value \
        .order.return_value.limit.return_value \
        .execute = AsyncMock(return_value=MagicMock(data=[
            {"feedback_score": None},
            {"feedback_score": None},
        ]))

    avg2 = await get_feedback_trend(mock_supabase2, "user2")
    passed = avg2 == 0.0
    log_result("3-2. 모두 피드백 없음 → avg=0.0", passed,
               f"실제 avg={avg2}" if not passed else "")

    # 3-3. shown/interacted 기록 없음 → None 반환
    mock_supabase3 = MagicMock()
    mock_supabase3.table.return_value.select.return_value \
        .eq.return_value.in_.return_value \
        .order.return_value.limit.return_value \
        .execute = AsyncMock(return_value=MagicMock(data=[]))

    avg3 = await get_feedback_trend(mock_supabase3, "user3")
    passed = avg3 is None
    log_result("3-3. shown 기록 없음 → None", passed,
               f"실제 avg={avg3}" if not passed else "")

    # 3-4. 부정 피드백 누적 → avg < 0
    mock_supabase4 = MagicMock()
    mock_supabase4.table.return_value.select.return_value \
        .eq.return_value.in_.return_value \
        .order.return_value.limit.return_value \
        .execute = AsyncMock(return_value=MagicMock(data=[
            {"feedback_score": -2},
            {"feedback_score": -2},
            {"feedback_score": None},  # 무시 → 0
        ]))

    avg4 = await get_feedback_trend(mock_supabase4, "user4")
    passed = avg4 is not None and avg4 < 0
    log_result(f"3-4. 부정 피드백 누적 → avg < 0 (실제: {avg4:.2f})" if avg4 else "3-4. 부정 피드백 누적 → avg < 0",
               passed, f"실제 avg={avg4}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 결과 요약
# ══════════════════════════════════════════════════════════════════════════════

def print_summary():
    total = len(_results)
    passed = sum(1 for r in _results if r["passed"])
    failed = total - passed

    print("\n" + "═"*60)
    print("  최종 결과 요약")
    print("═"*60)
    print(f"  전체: {total}  ✅ PASS: {passed}  ❌ FAIL: {failed}")

    if failed > 0:
        print("\n  실패 목록:")
        for r in _results:
            if not r["passed"]:
                print(f"    ❌ {r['name']}")
                if r["issues"]:
                    print(f"       → {r['issues']}")
    else:
        print("\n  모든 테스트 통과!")

    print("═"*60)
    return failed == 0


async def run_all():
    print("\n" + "█"*60)
    print("  신규 기능 시나리오 테스트")
    print("█"*60)

    test_pii_retry()
    test_validation_retry()
    await test_feedback_trend()
    return print_summary()


if __name__ == "__main__":
    import sys
    all_passed = asyncio.run(run_all())
    sys.exit(0 if all_passed else 1)
