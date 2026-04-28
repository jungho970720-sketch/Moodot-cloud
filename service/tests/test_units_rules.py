"""
rules / models 단위 테스트
──────────────────────────
실행: python tests/test_units_rules.py
pytest: pytest tests/test_units_rules.py -v

커버리지:
  - rules.base: InterventionTone.from_context(), get_description()
  - rules.negative_streak: check(), get_severity(), get_tone()
  - rules.no_recent_record: check(), get_severity(), get_tone()
  - rules.negative_ratio: check(), get_severity()
  - rules.positive_streak: check(), get_severity(), get_tone()
  - rules.frequency_limit: check()
  - models.intervention: Intervention.to_db_dict(), from_db_dict(), REASON_TO_MESSAGE_TYPE
"""
import asyncio
import sys
from pathlib import Path
import pytest

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from rules.base import InterventionTone
from rules.negative_streak import NegativeStreakRule
from rules.no_recent_record import NoRecentRecordRule
from rules.negative_ratio import NegativeRatioRule
from rules.positive_streak import PositiveStreakRule
from rules.frequency_limit import FrequencyLimitRule
from models.intervention import (
    Intervention, InterventionStatus, InterventionReason,
    MessageType, REASON_TO_MESSAGE_TYPE
)

_results: list[dict] = []

pytestmark = pytest.mark.asyncio


def log_result(name: str, passed: bool, issues: str = ""):
    _results.append({"name": name, "passed": passed, "issues": issues})
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"  {status}  {name}" + (f"\n         → {issues}" if issues else ""))


# ══════════════════════════════════════════════════════════════════════════════
# 1. InterventionTone
# ══════════════════════════════════════════════════════════════════════════════

def test_intervention_tone():
    print("\n[ 1. InterventionTone ]")

    cases = [
        ("negative_pattern",      1, InterventionTone.SUPPORTIVE,    "negative_pattern severity=1 → SUPPORTIVE"),
        ("negative_pattern",      2, InterventionTone.COMFORTING,    "negative_pattern severity=2 → COMFORTING"),
        ("negative_pattern",      3, InterventionTone.CONCERNED,     "negative_pattern severity=3 → CONCERNED"),
        ("no_recent_record",      1, InterventionTone.CURIOUS,       "no_recent_record severity=1 → CURIOUS"),
        ("no_recent_record",      3, InterventionTone.CONCERNED,     "no_recent_record severity=3 → CONCERNED"),
        ("positive_reinforcement",1, InterventionTone.ENCOURAGING,   "positive_reinforcement severity=1 → ENCOURAGING"),
        ("positive_reinforcement",3, InterventionTone.CELEBRATING,   "positive_reinforcement severity=3 → CELEBRATING"),
        ("unknown_reason",        1, InterventionTone.NEUTRAL,       "알 수 없는 reason → NEUTRAL"),
    ]

    for reason, severity, expected, label in cases:
        result = InterventionTone.from_context(reason, severity)
        passed = result == expected
        log_result(f"1. InterventionTone — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    # get_description 반환값 존재 여부
    for tone in [InterventionTone.SUPPORTIVE, InterventionTone.CURIOUS, InterventionTone.NEUTRAL]:
        desc = tone.get_description()
        passed = isinstance(desc, str) and len(desc) > 0
        log_result(f"1. InterventionTone.get_description — {tone.value}", passed,
                   f"got={desc!r}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 2. NegativeStreakRule
# ══════════════════════════════════════════════════════════════════════════════

async def test_negative_streak():
    print("\n[ 2. NegativeStreakRule ]")

    rule = NegativeStreakRule(threshold=3, severity_2_at=4, severity_3_at=5)

    # check()
    check_cases = [
        ({"consecutive_negative": 2}, False, "2개 → False"),
        ({"consecutive_negative": 3}, True,  "3개(threshold) → True"),
        ({"consecutive_negative": 5}, True,  "5개 → True"),
        ({},                          False, "키 없음 → False"),
    ]
    for ctx, expected, label in check_cases:
        result = await rule.check(ctx)
        passed = result == expected
        log_result(f"2. NegativeStreakRule.check — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    # get_severity()
    severity_cases = [
        ({"consecutive_negative": 3}, 1, "3개 → severity 1"),
        ({"consecutive_negative": 4}, 2, "4개 → severity 2"),
        ({"consecutive_negative": 5}, 3, "5개 → severity 3"),
    ]
    for ctx, expected, label in severity_cases:
        result = rule.get_severity(ctx)
        passed = result == expected
        log_result(f"2. NegativeStreakRule.get_severity — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    # get_tone() — last_context 기반
    await rule.check({"consecutive_negative": 3})
    tone = rule.get_tone()
    passed = tone == InterventionTone.SUPPORTIVE
    log_result("2. NegativeStreakRule.get_tone — consec=3 → SUPPORTIVE", passed,
               f"got={tone}" if not passed else "")

    # get_reason()
    passed = rule.get_reason() == InterventionReason.NEGATIVE_PATTERN.value
    log_result("2. NegativeStreakRule.get_reason → negative_pattern", passed)


# ══════════════════════════════════════════════════════════════════════════════
# 3. NoRecentRecordRule
# ══════════════════════════════════════════════════════════════════════════════

async def test_no_recent_record():
    print("\n[ 3. NoRecentRecordRule ]")

    rule = NoRecentRecordRule(threshold_days=3, severity_2_at=5, severity_3_at=7)

    check_cases = [
        ({"days_since_last_record": 2},    False, "2일 → False"),
        ({"days_since_last_record": 3},    True,  "3일(threshold) → True"),
        ({"days_since_last_record": 10},   True,  "10일 → True"),
        ({"days_since_last_record": None}, False, "None → False"),
        ({},                               False, "키 없음 → False"),
    ]
    for ctx, expected, label in check_cases:
        result = await rule.check(ctx)
        passed = result == expected
        log_result(f"3. NoRecentRecordRule.check — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    severity_cases = [
        ({"days_since_last_record": 3}, 1, "3일 → severity 1"),
        ({"days_since_last_record": 5}, 2, "5일 → severity 2"),
        ({"days_since_last_record": 7}, 3, "7일 → severity 3"),
    ]
    for ctx, expected, label in severity_cases:
        result = rule.get_severity(ctx)
        passed = result == expected
        log_result(f"3. NoRecentRecordRule.get_severity — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    passed = rule.get_reason() == InterventionReason.NO_RECENT_RECORD.value
    log_result("3. NoRecentRecordRule.get_reason → no_recent_record", passed)


# ══════════════════════════════════════════════════════════════════════════════
# 4. NegativeRatioRule
# ══════════════════════════════════════════════════════════════════════════════

async def test_negative_ratio():
    print("\n[ 4. NegativeRatioRule ]")

    rule = NegativeRatioRule(threshold_ratio=0.7, min_count=5)

    def stats(total, negative):
        return {"emotion_stats": {"total_count": total, "negative_count": negative}}

    check_cases = [
        (stats(10, 6), False, "60% (min=5 충족) → False"),
        (stats(10, 7), True,  "70% → True"),
        (stats(4,  3), False, "min_count 미달 → False"),
        (stats(0,  0), False, "데이터 없음 → False"),
    ]
    for ctx, expected, label in check_cases:
        result = await rule.check(ctx)
        passed = result == expected
        log_result(f"4. NegativeRatioRule.check — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    severity_cases = [
        (stats(10, 7), 1, "70% → severity 1"),
        (stats(10, 8), 2, "80% → severity 2"),
        (stats(10, 9), 3, "90% → severity 3"),
    ]
    for ctx, expected, label in severity_cases:
        result = rule.get_severity(ctx)
        passed = result == expected
        log_result(f"4. NegativeRatioRule.get_severity — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 5. PositiveStreakRule
# ══════════════════════════════════════════════════════════════════════════════

async def test_positive_streak():
    print("\n[ 5. PositiveStreakRule ]")

    rule = PositiveStreakRule(threshold=3, severity_2_at=4, severity_3_at=5)

    check_cases = [
        ({"consecutive_positive": 2}, False, "2개 → False"),
        ({"consecutive_positive": 3}, True,  "3개(threshold) → True"),
        ({},                          False, "키 없음 → False"),
    ]
    for ctx, expected, label in check_cases:
        result = await rule.check(ctx)
        passed = result == expected
        log_result(f"5. PositiveStreakRule.check — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    severity_cases = [
        ({"consecutive_positive": 3}, 1, "3개 → severity 1"),
        ({"consecutive_positive": 4}, 2, "4개 → severity 2"),
        ({"consecutive_positive": 5}, 3, "5개 → severity 3"),
    ]
    for ctx, expected, label in severity_cases:
        result = rule.get_severity(ctx)
        passed = result == expected
        log_result(f"5. PositiveStreakRule.get_severity — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")

    passed = rule.get_reason() == InterventionReason.POSITIVE_REINFORCEMENT.value
    log_result("5. PositiveStreakRule.get_reason → positive_reinforcement", passed)


# ══════════════════════════════════════════════════════════════════════════════
# 6. FrequencyLimitRule
# ══════════════════════════════════════════════════════════════════════════════

async def test_frequency_limit():
    print("\n[ 6. FrequencyLimitRule ]")

    rule = FrequencyLimitRule(max_per_day=2, min_hours_between=4)

    check_cases = [
        ({"today_count": 1, "hours_since_last": 5.0,  "feedback_avg_score": None}, False, "1회/5h → 통과"),
        ({"today_count": 2, "hours_since_last": 5.0,  "feedback_avg_score": None}, True,  "2회(한도) → 차단"),
        ({"today_count": 1, "hours_since_last": 3.9,  "feedback_avg_score": None}, True,  "4h 미만 → 차단"),
        ({"today_count": 1, "hours_since_last": 4.0,  "feedback_avg_score": None}, False, "정확히 4h → 통과"),
        ({"today_count": 1, "hours_since_last": None, "feedback_avg_score": None}, False, "hours=None → 통과"),
        # 피드백 점수에 따른 동적 한도
        ({"today_count": 2, "hours_since_last": 5.0,  "feedback_avg_score": 2.0},  False, "avg≥2 → 한도+1(3), count=2 → 통과"),
        ({"today_count": 1, "hours_since_last": 5.0,  "feedback_avg_score": -1.0}, True,  "avg<0 → 한도-1(1) → 차단"),
    ]
    for ctx, expected, label in check_cases:
        result = await rule.check(ctx)
        passed = result == expected
        log_result(f"6. FrequencyLimitRule.check — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 7. Intervention 모델
# ══════════════════════════════════════════════════════════════════════════════

def test_intervention_model():
    print("\n[ 7. Intervention 모델 ]")

    # to_db_dict()
    iv = Intervention(user_id="u1", reason="negative_pattern", message="테스트")
    d = iv.to_db_dict()
    passed = (
        d["user_id"] == "u1"
        and d["reason"] == "negative_pattern"
        and d["message"] == "테스트"
        and d["status"] == InterventionStatus.PENDING.value
        and "id" not in d
        and "created_at" not in d
    )
    log_result("7. Intervention.to_db_dict — 필드 정확성", passed,
               f"got={d}" if not passed else "")

    # from_db_dict()
    data = {"id": "abc", "user_id": "u1", "reason": "no_recent_record",
            "message": "안녕", "status": "shown", "message_type": "checkin"}
    iv2 = Intervention.from_db_dict(data)
    passed = (
        iv2.id == "abc"
        and iv2.status == "shown"
        and iv2.message_type == "checkin"
    )
    log_result("7. Intervention.from_db_dict — 필드 복원", passed,
               f"got id={iv2.id}, status={iv2.status}" if not passed else "")

    # REASON_TO_MESSAGE_TYPE
    mapping_cases = [
        ("negative_pattern",       MessageType.EMPATHY.value),
        ("positive_reinforcement", MessageType.ENCOURAGEMENT.value),
        ("no_recent_record",       MessageType.CHECKIN.value),
    ]
    for reason, expected in mapping_cases:
        result = REASON_TO_MESSAGE_TYPE.get(reason)
        passed = result == expected
        log_result(f"7. REASON_TO_MESSAGE_TYPE — {reason} → {expected}", passed,
                   f"got={result}" if not passed else "")


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
    print("  rules / models 단위 테스트")
    print("█"*60)

    test_intervention_tone()
    await test_negative_streak()
    await test_no_recent_record()
    await test_negative_ratio()
    await test_positive_streak()
    await test_frequency_limit()
    test_intervention_model()
    return print_summary()


if __name__ == "__main__":
    all_passed = asyncio.run(run_all())
    sys.exit(0 if all_passed else 1)
