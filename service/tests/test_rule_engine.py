# tests/test_rule_engine.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from rules import RuleEngine

#pytest - asyncio 설정 추가
pytestmark = pytest.mark.asyncio

@pytest.fixture
def mock_supabase():
    """Supabase 모킹"""
    return AsyncMock()

@pytest.fixture
def rule_engine(mock_supabase):
    """RuleEngine 인스턴스"""
    return RuleEngine(mock_supabase)


class TestRuleEngine:
    """RuleEngine 통합 테스트"""
    
    @pytest.mark.asyncio
    async def test_frequency_limit_blocks_intervention(self, rule_engine):
        """빈도 제한 규칙이 개입을 차단하는지"""
        # Given: 오늘 이미 2번 개입
        rule_engine._build_context = AsyncMock(return_value={
            'user_id': 'test_user',
            'today_count': 2,  # 제한 초과
            'hours_since_last': 1,
            'days_since_last_record': 5,
            'consecutive_negative': 3,
            'recent_emotions': [],
            'emotion_stats': {}
        })
        
        # When
        result = await rule_engine.evaluate('test_user')
        
        # Then
        assert result['should_intervene'] is False
        assert result['reason'] == 'frequency_limit'
        assert result['rule'] == 'frequency_limit'
    
    @pytest.mark.asyncio
    async def test_negative_streak_triggers_intervention(self, rule_engine):
        """연속 부정 감정이 개입을 트리거하는지"""
        # Given: 연속 3개 부정 감정
        rule_engine._build_context = AsyncMock(return_value={
            'user_id': 'test_user',
            'today_count': 0,
            'hours_since_last': 999,
            'days_since_last_record': 1,
            'consecutive_negative': 3,  # 연속 3개
            'recent_emotions': [
                {'emotion_name': 'sad'},
                {'emotion_name': 'bad'},
                {'emotion_name': 'sad'}
            ],
            'emotion_stats': {}
        })
        
        # When
        result = await rule_engine.evaluate('test_user')
        
        # Then
        assert result['should_intervene'] is True
        assert result['reason'] == 'negative_pattern'
        assert result['rule'] == 'negative_streak'
        assert result['tone'] == 'supportive'
    
    @pytest.mark.asyncio
    async def test_no_recent_record_triggers_intervention(self, rule_engine):
        """장기 미기록이 개입을 트리거하는지"""
        # Given: 5일 미기록
        rule_engine._build_context = AsyncMock(return_value={
            'user_id': 'test_user',
            'today_count': 0,
            'hours_since_last': 999,
            'days_since_last_record': 5,  # 5일 미기록
            'consecutive_negative': 0,
            'recent_emotions': [],
            'emotion_stats': {}
        })
        
        # When
        result = await rule_engine.evaluate('test_user')
        
        # Then
        assert result['should_intervene'] is True
        assert result['reason'] == 'no_recent_record'
        assert result['rule'] == 'no_recent_record'
        assert result['severity'] == 2  # 5일 = 중간 심각도
    
    @pytest.mark.asyncio
    async def test_priority_order(self, rule_engine):
        """우선순위가 제대로 작동하는지"""
        # Given: 빈도 제한 + 연속 부정 동시 만족
        rule_engine._build_context = AsyncMock(return_value={
            'user_id': 'test_user',
            'today_count': 2,  # 빈도 제한
            'hours_since_last': 1,
            'days_since_last_record': 1,
            'consecutive_negative': 3,  # 연속 부정도 만족
            'recent_emotions': [],
            'emotion_stats': {}
        })
        
        # When
        result = await rule_engine.evaluate('test_user')
        
        # Then: 빈도 제한(priority=0)이 먼저 실행되어 차단
        assert result['should_intervene'] is False
        assert result['rule'] == 'frequency_limit'
    
    @pytest.mark.asyncio
    async def test_no_trigger(self, rule_engine):
        """모든 규칙 불만족 시 개입 안 함"""
        # Given: 정상 범위
        rule_engine._build_context = AsyncMock(return_value={
            'user_id': 'test_user',
            'today_count': 0,
            'hours_since_last': 999,
            'days_since_last_record': 1,
            'consecutive_negative': 1,
            'recent_emotions': [],
            'emotion_stats': {'total_count': 3, 'negative_count': 1}
        })
        
        # When
        result = await rule_engine.evaluate('test_user')
        
        # Then
        assert result['should_intervene'] is False
        assert result['reason'] == 'no_trigger'
