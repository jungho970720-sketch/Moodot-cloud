# AI Worker SQS/EventBridge Migration Plan

Moodot AI Worker는 현재 RDS PostgreSQL의 `processed=false` 기록을 polling해서 처리합니다.
이 문서는 polling을 AWS-native 이벤트 흐름으로 전환하기 위한 계획입니다.

## 현재 구조

```text
Express API -> RDS memories insert
AI Worker -> RDS polling -> Pipeline -> RDS interventions insert
```

장점:

- 구현이 단순함
- Supabase Realtime 없이 동작함
- Worker가 꺼져 있어도 `processed=false` 기록을 다시 처리할 수 있음

한계:

- 실시간성이 약함
- Worker가 주기적으로 DB를 조회함
- 이벤트 처리량이 늘면 DB polling 비용/부하가 커질 수 있음

## 목표 구조

```text
Express API -> RDS memories insert
Express API -> SQS message enqueue
AI Worker -> SQS long polling -> Pipeline -> RDS interventions insert
AI Worker -> RDS processed=true update
```

EventBridge를 함께 쓰는 경우:

```text
Express API -> EventBridge PutEvents -> Rule -> SQS -> AI Worker
```

## 권장 단계

### 1. SQS 먼저 도입

가장 단순한 전환입니다.

- 새 기록 저장 성공 후 backend가 SQS에 message 전송
- 메시지 payload는 최소 정보만 포함
- AI Worker는 SQS long polling으로 메시지를 수신
- 처리 성공 후 SQS message 삭제
- 처리 실패 시 message를 삭제하지 않아 재시도

권장 payload:

```json
{
  "type": "memory.created",
  "memory_id": 123,
  "user_id": "cognito-sub",
  "created_at": "2026-06-04T00:00:00Z"
}
```

주의:

- 본문 텍스트는 SQS에 싣지 않습니다.
- Worker는 `memory_id`로 RDS에서 다시 조회합니다.
- 개인정보/감정 본문은 RDS 암호화 저장 구조를 유지합니다.

### 2. RDS polling은 fallback으로 유지

SQS 전환 후에도 일정 기간은 polling 안전장치를 남깁니다.

- SQS 누락/실패 대비
- Worker 재시작 후 미처리 기록 복구
- `processed=false` 기록을 주기적으로 보정 처리

### 3. EventBridge는 이후 확장

EventBridge는 이벤트 종류가 늘어날 때 도입하는 편이 좋습니다.

도입 후보 이벤트:

- `memory.created`
- `intervention.feedback.created`
- `user.signed_up`
- `collection.created`

## 필요한 AWS 리소스

### SQS

- Queue name: `moodot-ai-worker-events`
- Type: Standard queue
- Visibility timeout: 60-120초부터 시작
- Message retention: 4일 기본값 유지 가능
- Dead-letter queue:
  - `moodot-ai-worker-events-dlq`
  - max receive count: 3-5

### IAM

EC2 IAM Role `MoodotEc2S3Role`에 아래 권한 추가 후보:

```json
{
  "Effect": "Allow",
  "Action": [
    "sqs:SendMessage",
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes"
  ],
  "Resource": "arn:aws:sqs:ap-northeast-2:<account-id>:moodot-ai-worker-events"
}
```

DLQ 조회/운영이 필요하면 DLQ ARN도 별도로 추가합니다.

## 코드 변경 방향

### backend

`backend/src/routes/memories.ts`의 create 성공 후:

1. RDS insert 성공
2. 생성된 memory id 확보
3. SQS message 전송
4. SQS 실패 시:
   - 사용자 요청은 성공 유지
   - backend log에 경고 기록
   - RDS polling fallback이 나중에 처리

환경변수 후보:

```env
AI_EVENT_QUEUE_URL=
AWS_REGION=ap-northeast-2
```

### service

새 모드 후보:

```env
WORKER_EVENT_SOURCE=sqs
SQS_QUEUE_URL=
SQS_WAIT_TIME_SECONDS=20
SQS_MAX_MESSAGES=5
```

Worker 흐름:

1. SQS receive message
2. body parse
3. `memory_id`로 RDS memory 조회
4. `Pipeline.process_emotion({"record": memory})`
5. 성공 시 SQS message delete
6. 실패 시 delete 하지 않음

## 검증 순서

1. 로컬/EC2에서 SQS queue URL 환경변수 설정
2. backend에서 테스트 memory 생성
3. SQS message 생성 확인
4. Worker가 message 수신 확인
5. RDS `interventions` 생성 확인
6. RDS `memories.processed=true` 확인
7. 실패 케이스에서 DLQ 이동 확인

## 운영 주의

- RDS가 꺼져 있으면 Worker는 메시지를 처리할 수 없습니다.
- 비용 절감 모드에서는 EC2/RDS/Worker가 모두 꺼져 있으므로 SQS 메시지가 쌓일 수 있습니다.
- 다시 켤 때 Worker가 밀린 메시지를 처리하게 됩니다.
- DLQ에 메시지가 쌓이면 원인을 보고 재처리 여부를 판단해야 합니다.
