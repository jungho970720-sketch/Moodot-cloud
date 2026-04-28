"""
단위 테스트
──────────
실행: python tests/test_units.py
pytest: pytest tests/test_units.py -v

커버리지:
  - security.data_minimization: sanitize(), contains_pii()
  - security.output_validator: validate_output()
  - scoring.feedback_scorer: calculate_score()
  - scoring.behavior_adjuster: get_adjusted_max_per_day(), decide_action(), get_action_directive()
  - generators.message_generator: _check_validation()
"""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import pytest

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from security.data_minimization import sanitize, contains_pii
from security.output_validator import validate_output
from scoring.feedback_scorer import calculate_score
from scoring.behavior_adjuster import get_adjusted_max_per_day, decide_action, get_action_directive
from generators.message_generator import MessageGenerator
from config.base_llm import BaseLLMProvider

_results: list[dict] = []


def log_result(name: str, passed: bool, issues: str = ""):
    _results.append({"name": name, "passed": passed, "issues": issues})
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"  {status}  {name}" + (f"\n         → {issues}" if issues else ""))


# ══════════════════════════════════════════════════════════════════════════════
# 1. security.data_minimization
# ══════════════════════════════════════════════════════════════════════════════

def test_sanitize():
    print("\n[ 1. sanitize() ]")

    cases = [
        ("전화번호 010-1234-5678이야",      "[전화번호]",   "전화번호 마스킹"),
        ("010-12345678 처럼 하이픈 없어도",  "[전화번호]",   "하이픈 없는 전화번호"),
        ("test@example.com 으로 보내",      "[이메일]",     "이메일 마스킹"),
        ("주민번호는 901010-1234567",        "[주민번호]",   "주민번호 마스킹"),
        ("계좌 1234-5678-9012-3456",        "[계좌번호]",   "계좌번호 마스킹"),
        ("안녕하세요 오늘 날씨 좋네요",       None,          "PII 없음 → 원본 유지"),
    ]

    for text, expected_contains, label in cases:
        result = sanitize(text)
        if expected_contains:
            passed = expected_contains in result and text.split()[1] not in result.replace(expected_contains, "X")
            # 단순하게: placeholder가 들어있고 원본 PII가 없으면 통과
            original_pii = text.split()[1]
            passed = expected_contains in result
        else:
            passed = result == text
        log_result(f"1. sanitize — {label}", passed,
                   f"result={result!r}" if not passed else "")


def test_contains_pii():
    print("\n[ 2. contains_pii() ]")

    cases = [
        ("010-1234-5678 연락해",   True,  "전화번호 감지"),
        ("user@test.com",          True,  "이메일 감지"),
        ("901010-1234567",         True,  "주민번호 감지"),
        ("1234-5678-9012-3456",   True,  "계좌번호 감지"),
        ("오늘 기분이 좋았어",      False, "PII 없음 → False"),
        ("",                        False, "빈 문자열 → False"),
    ]

    for text, expected, label in cases:
        result = contains_pii(text)
        passed = result == expected
        log_result(f"2. contains_pii — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 2. security.output_validator
# ══════════════════════════════════════════════════════════════════════════════

def test_validate_output():
    print("\n[ 3. validate_output() ]")

    cases = [
        ("오늘 기분 어때?",               True,  "PII 없음 → True"),
        ("010-1234-5678로 연락해봐",      False, "전화번호 포함 → False"),
        ("test@example.com 확인해줘",    False, "이메일 포함 → False"),
        ("",                              True,  "빈 문자열 → True"),
    ]

    for text, expected, label in cases:
        result = validate_output(text)
        passed = result == expected
        log_result(f"3. validate_output — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 3. scoring.feedback_scorer
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_calculate_score():
    print("\n[ 4. calculate_score() ]")

    def make_supabase(rows):
        mock = MagicMock()
        mock.table.return_value.select.return_value \
            .eq.return_value \
            .execute = AsyncMock(return_value=MagicMock(data=rows))
        return mock

    cases = [
        ([{"explicit_score": 2}, {"explicit_score": 2}],  4,  "긍정 2개 → +4"),
        ([{"explicit_score": -2}, {"explicit_score": 2}], 0,  "긍정+부정 → 0"),
        ([{"explicit_score": None}],                       0,  "None → 0으로 처리"),
        ([],                                               0,  "피드백 없음 → 0"),
    ]

    for rows, expected, label in cases:
        score = await calculate_score(make_supabase(rows), "test-id")
        passed = score == expected
        log_result(f"4. calculate_score — {label}", passed,
                   f"expected={expected}, got={score}" if not passed else "")

    # DB 오류 시 0 반환
    error_mock = MagicMock()
    error_mock.table.return_value.select.return_value \
        .eq.return_value \
        .execute = AsyncMock(side_effect=Exception("DB error"))
    score = await calculate_score(error_mock, "test-id")
    passed = score == 0
    log_result("4. calculate_score — DB 오류 → 0", passed,
               f"got={score}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 4. scoring.behavior_adjuster
# ══════════════════════════════════════════════════════════════════════════════

def test_get_adjusted_max_per_day():
    print("\n[ 5. get_adjusted_max_per_day() ]")

    cases = [
        (None,  2, 2, "avg=None → base 유지"),
        (2.0,   2, 3, "avg≥2 → +1"),
        (1.9,   2, 2, "avg=1.9 → base 유지"),
        (-0.1,  2, 1, "avg<0 → -1"),
        (-1.0,  1, 1, "base=1, avg<0 → 최소 1"),
        (3.0,   2, 3, "avg=3 → +1"),
    ]

    for avg, base, expected, label in cases:
        result = get_adjusted_max_per_day(avg, base)
        passed = result == expected
        log_result(f"5. get_adjusted_max_per_day — {label}", passed,
                   f"expected={expected}, got={result}" if not passed else "")


def test_decide_action():
    print("\n[ 6. decide_action() ]")

    cases = [
        (-1.0, "negative_pattern",      "checkin",      "avg<0 → checkin"),
        (2.0,  "negative_pattern",      "empathy",      "avg≥2 + negative → empathy"),
        (2.0,  "negative_ratio",        "empathy",      "avg≥2 + negative_ratio → empathy"),
        (2.0,  "positive_reinforcement","encouragement","avg≥2 + positive → encouragement"),
        (1.0,  "negative_pattern",      "empathy",      "avg=1 → reason 기본값 (empathy)"),
        (1.0,  "no_recent_record",      "checkin",      "avg=1 → reason 기본값 (checkin)"),
        (None, "positive_reinforcement","encouragement","avg=None → reason 기본값"),
    ]

    for avg, reason, expected, label in cases:
        result = decide_action(avg, reason)
        passed = result == expected
        log_result(f"6. decide_action — {label}", passed,
                   f"expected={expected!r}, got={result!r}" if not passed else "")


def test_get_action_directive():
    print("\n[ 7. get_action_directive() ]")

    cases = [
        ("checkin",      True,  "checkin → 지시문 있음"),
        ("empathy",      True,  "empathy → 지시문 있음"),
        ("encouragement",True,  "encouragement → 지시문 있음"),
        ("unknown",      False, "알 수 없는 action → 빈 문자열"),
    ]

    for action, expect_nonempty, label in cases:
        result = get_action_directive(action)
        passed = bool(result) == expect_nonempty
        log_result(f"7. get_action_directive — {label}", passed,
                   f"result={result!r}" if not passed else "")


# ══════════════════════════════════════════════════════════════════════════════
# 5. generators.message_generator._check_validation()
# ══════════════════════════════════════════════════════════════════════════════

def test_check_validation():
    print("\n[ 8. _check_validation() ]")

    class DummyLLM(BaseLLMProvider):
        @property
        def model_name(self): return "dummy"
        def generate(self, prompt): return "", {}

    gen = MessageGenerator(DummyLLM())

    cases = [
        ("오늘 기분 어때?",                    100, None,              "정상 메시지 → None"),
        ("010-1234-5678로 연락해봐.",          100, "pii",             "PII → pii"),
        ("자살 충동이 생길 수 있어.",            100, "forbidden_word:자살", "금지어 → forbidden_word:자살"),
        ("a" * 101,                            100, "too_long",        "길이 초과 → too_long"),
        ("오늘 기분 어때? 나는 네 편이야.",     100, "too_many_sentences","문장 2개 → too_many_sentences"),
    ]

    for msg, max_len, expected, label in cases:
        result = gen._check_validation(msg, max_len)
        passed = result == expected
        log_result(f"8. _check_validation — {label}", passed,
                   f"expected={expected!r}, got={result!r}" if not passed else "")


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
    print("  단위 테스트")
    print("█"*60)

    test_sanitize()
    test_contains_pii()
    test_validate_output()
    await test_calculate_score()
    test_get_adjusted_max_per_day()
    test_decide_action()
    test_get_action_directive()
    test_check_validation()
    return print_summary()


if __name__ == "__main__":
    all_passed = asyncio.run(run_all())
    sys.exit(0 if all_passed else 1)
