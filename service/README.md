# AI 에이전트 워커

감정 기록을 감지하고 개입 메시지 생성/피드백 반영을 처리하는 백그라운드 워커입니다.

## 역할

- RDS polling 또는 SQS로 `memories` 이벤트 처리
- 개입 규칙 판단
- AI 또는 템플릿 기반 메시지 생성
- 주기적으로 처리되지 않은 감정 기록 재점검
- 헬스 체크용 HTTP 포트 제공

## 필수 환경변수

```env
WORKER_DATA_PROVIDER=rds
DB_HOST=
DB_PORT=5432
DB_NAME=postgres
DB_USER=
DB_PASSWORD=
DATABASE_SSL=true
MEMORY_TEXT_ENCRYPTION_KEY=
PORT=8000
LLM_PROVIDER=openai
```

선택 환경변수:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OLLAMA_BASE_URL=
OLLAMA_MODEL=
DB_POOL_MAX_SIZE=2
WORKER_EVENT_SOURCE=polling
SQS_QUEUE_URL=
SQS_REGION=ap-northeast-2
SQS_WAIT_TIME_SECONDS=20
SQS_MAX_MESSAGES=5
```

현재 워커는 RDS PostgreSQL의 `processed=false` 기록을 주기적으로 polling해서 처리합니다.
`WORKER_EVENT_SOURCE=sqs`로 설정하면 SQS에서 `memory.created` 메시지를 받아 처리하고,
RDS polling은 누락 복구용 fallback으로 계속 유지합니다.

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
  -e WORKER_DATA_PROVIDER=rds \
  -e DB_HOST=... \
  -e DB_PORT=5432 \
  -e DB_NAME=postgres \
  -e DB_USER=postgres \
  -e DB_PASSWORD=... \
  -e DATABASE_SSL=true \
  -e LLM_PROVIDER=openai \
  -e OPENAI_API_KEY=... \
  moodot-ai-worker
```

## 배포 메모

- 현재 워커는 단일 프로세스 장기 실행 방식입니다.
- SQS 모드는 `moodot-ai-worker-events` 큐에서 메시지를 읽고, 성공 시 메시지를 삭제합니다.
- 처리 실패 시 메시지를 삭제하지 않아 SQS 재시도/DLQ 흐름을 사용합니다.
- Lambda 전환 시 엔트리포인트는 `service/lambda_handler.handler`를 사용합니다.
- Lambda의 SQS event source mapping은 partial batch response를 사용하도록 두는 것이 좋습니다.
- ECS로 올릴 경우 health check는 `PORT` 기반 HTTP 응답을 사용하면 됩니다.
- FE/BE 배포와 분리해서 `service/**` 변경 시에만 별도 파이프라인을 타도록 구성하는 것이 좋습니다.

Lambda 전환 작업 메모는 [docs/ai-worker-lambda-migration.md](/Users/jungho/Moodot-cloud/docs/ai-worker-lambda-migration.md)에 정리했습니다.
로컬에서 Lambda 업로드용 zip을 만들려면 `./service/build_lambda_package.sh`를 실행하면 됩니다.
