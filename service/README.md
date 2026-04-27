# AI 에이전트 워커

감정 기록을 실시간으로 감지하고 개입 메시지 생성/피드백 반영을 처리하는
백그라운드 워커입니다.

## 역할

- Supabase Realtime으로 `memories`, `intervention_feedback` 이벤트 구독
- 개입 규칙 판단
- AI 또는 템플릿 기반 메시지 생성
- 주기적으로 처리되지 않은 감정 기록 재점검
- 헬스 체크용 HTTP 포트 제공

## 필수 환경변수

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
PORT=8000
LLM_PROVIDER=ollama
```

선택 환경변수:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OLLAMA_BASE_URL=
OLLAMA_MODEL=
```

## 로컬 실행

### 1. 가상환경 생성 및 활성화

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. 실행

```bash
python main.py
```

헬스 체크:

```bash
curl http://localhost:8000
```

## Docker 실행

루트 디렉터리에서 이미지 빌드:

```bash
docker build -f service/Dockerfile -t moodot-ai-worker .
```

컨테이너 실행:

```bash
docker run --rm -p 8000:8000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_KEY=... \
  -e LLM_PROVIDER=openai \
  -e OPENAI_API_KEY=... \
  moodot-ai-worker
```

## 배포 메모

- 현재 워커는 단일 프로세스 장기 실행 방식입니다.
- ECS로 올릴 경우 health check는 `PORT` 기반 HTTP 응답을 사용하면 됩니다.
- FE/BE 배포와 분리해서 `service/**` 변경 시에만 별도 파이프라인을 타도록 구성하는 것이 좋습니다.
