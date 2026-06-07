# prompts/message_prompts.py
"""
메시지 생성용 프롬프트 템플릿
"""


class PromptTemplate:
    def __init__(self, input_variables: list[str], template: str):
        self.input_variables = input_variables
        self.template = template

    def format(self, **kwargs) -> str:
        return self.template.format(**kwargs)


# 기본 시스템 프롬프트
SYSTEM_PROMPT = """
당신은 사용자의 감정을 이해하고 공감하는 친구입니다.

역할:
- 사용자의 감정에 공감하고 지지합니다
- 강요하지 않고 부드럽게 제안합니다
- 간결하고 자연스러운 대화를 합니다

제약사항:
- 반드시 한 문장으로만 말하세요
- 의학적 조언을 하지 마세요
- 진단하거나 판단하지 마세요
- 데이터에 없는 내용을 추측하지 마세요
- 이모지를 사용하지 마세요
- 직접적인 질문(예: "괜찮아?", "힘들지?", "맞아?")을 사용하지 마세요
- 사용자 상태에 대한 해석을 메시지 안에 포함하세요
- 선택지 없이도 메시지만으로 맥락이 충분히 전달되도록 작성하세요

좋은 예시:
- "요즘 비슷한 감정이 이어지는 것 같다는 느낌이야."
- "며칠 동안 쉽지 않은 시간이었을 것 같다."
- "그 감정이 꽤 오래 이어진 것 같다는 생각이 들었어."
"""


# ✅ InterventionReason에 맞게 수정된 템플릿들
NO_RECENT_RECORD_TEMPLATE = PromptTemplate(
    input_variables=["days_since", "last_emotion", "recent_memories"],
    template="""
{system_prompt}

사용자 상황:
- {days_since}일 동안 감정 기록을 하지 않았습니다
- 마지막 감정: {last_emotion}
- 최근 기록 내용:
{recent_memories}

한 문장으로 자연스럽게 말 걸어주세요:
"""
)


# ✅ NEGATIVE_STREAK → NEGATIVE_PATTERN으로 변경
NEGATIVE_PATTERN_TEMPLATE = PromptTemplate(
    input_variables=["consecutive_count", "recent_emotions", "recent_memories"],
    template="""
{system_prompt}

사용자 상황:
- 최근 {consecutive_count}개의 감정이 부정적입니다 (bad, sad)
- 최근 감정: {recent_emotions}
- 최근 기록 내용:
{recent_memories}

공감하며 한 문장으로 말 걸어주세요:
"""
)


# ✅ POSITIVE_STREAK → POSITIVE_REINFORCEMENT로 변경
POSITIVE_REINFORCEMENT_TEMPLATE = PromptTemplate(
    input_variables=["consecutive_count", "recent_emotions", "recent_memories"],
    template="""
{system_prompt}

사용자 상황:
- 최근 {consecutive_count}개의 감정이 긍정적입니다 (good)
- 최근 감정: {recent_emotions}
- 최근 기록 내용:
{recent_memories}

격려하며 한 문장으로 말 걸어주세요:
"""
)


# ✅ 부정 감정 비율 높을 때 템플릿 추가
NEGATIVE_RATIO_TEMPLATE = PromptTemplate(
    input_variables=["negative_ratio", "total_count", "emotion_distribution", "recent_memories"],
    template="""
{system_prompt}

사용자 상황:
- 최근 {total_count}개 감정 중 {negative_ratio}%가 부정적입니다
- 감정 분포: {emotion_distribution}
- 최근 기록 내용:
{recent_memories}

부담스럽지 않게 공감하며 한 문장으로 말 걸어주세요:
"""
)


# ✅ 기본 템플릿 (이유 없을 때)
DEFAULT_TEMPLATE = PromptTemplate(
    input_variables=["context"],
    template="""
{system_prompt}

사용자 상황:
{context}

자연스럽게 한 문장으로 말 걸어주세요:
"""
)


def get_prompt_template(reason: str) -> PromptTemplate:
    """
    이유에 따른 프롬프트 템플릿 반환
    
    Args:
        reason: 개입 이유 (InterventionReason enum 값)
            - "no_recent_record": 장기간 미기록
            - "negative_pattern": 부정 감정 패턴 (연속 또는 비율)
            - "positive_reinforcement": 긍정 강화
        
    Returns:
        PromptTemplate
        
    Example:
        >>> template = get_prompt_template("no_recent_record")
        >>> message = template.format(
        ...     system_prompt=SYSTEM_PROMPT,
        ...     days_since=3,
        ...     last_emotion="good"
        ... )
    """
    # ✅ InterventionReason enum 값에 맞춘 매핑
    templates = {
        "no_recent_record": NO_RECENT_RECORD_TEMPLATE,
        "negative_pattern": NEGATIVE_PATTERN_TEMPLATE,
        "positive_reinforcement": POSITIVE_REINFORCEMENT_TEMPLATE,
        "negative_ratio": NEGATIVE_RATIO_TEMPLATE,  # ✅ 추가
    }
    
    return templates.get(
        reason,
        DEFAULT_TEMPLATE  # ✅ 기본 템플릿
    )


# ✅ 감정 이름 한글 매핑 (필요 시 사용)
EMOTION_NAMES_KR = {
    'good': '좋음',
    'bad': '나쁨',
    'sad': '슬픔',
    'calm': '평온'
}


def format_emotion_list(emotions: list) -> str:
    """
    감정 리스트를 자연스러운 문자열로 변환
    
    Args:
        emotions: 감정 이름 리스트 ['bad', 'sad', 'bad']
        
    Returns:
        "나쁨, 슬픔, 나쁨"
        
    Example:
        >>> format_emotion_list(['bad', 'sad', 'bad'])
        '나쁨, 슬픔, 나쁨'
    """
    return ', '.join([EMOTION_NAMES_KR.get(e, e) for e in emotions])


def format_emotion_distribution(distribution: dict) -> str:
    """
    감정 분포를 자연스러운 문자열로 변환
    
    Args:
        distribution: {'good': 2, 'bad': 5, 'sad': 3}
        
    Returns:
        "좋음 2회, 나쁨 5회, 슬픔 3회"
        
    Example:
        >>> format_emotion_distribution({'good': 2, 'bad': 5})
        '좋음 2회, 나쁨 5회'
    """
    formatted = []
    for emotion, count in distribution.items():
        kr_name = EMOTION_NAMES_KR.get(emotion, emotion)
        formatted.append(f"{kr_name} {count}회")
    return ', '.join(formatted)
