# AI Worker Lambda Migration

Moodot AI Worker를 EC2 PM2 장기 실행 프로세스에서 AWS Lambda + SQS 트리거 구조로 옮기기 위한 정리 문서입니다.

## 목표 구조

```text
Backend -> SQS memory.created
SQS -> Lambda handler
Lambda -> RDS read/write
```

현재 `service/main.py`는 PM2 장기 실행용입니다.
새 Lambda 엔트리포인트는 `service/lambda_handler.handler`입니다.

## 코드 상태

이미 준비된 것:

- `service/lambda_handler.py`
  - Lambda SQS event를 받아 batch 처리
  - 실패한 message만 `batchItemFailures`로 반환
- `service/runtime.py`
  - RDS store / rule engine / message generator 공통 초기화
- `service/events/sqs.py`
  - 기존 PM2 long polling 재사용
  - Lambda record 처리용 `handle_lambda_record()` 추가

검증 완료:

```bash
python3 -m compileall service
python3 -m pytest service/tests/test_lambda_handler.py service/tests/test_sqs_events.py service/tests/test_units_rules.py service/tests/test_rule_engine.py
```

## Lambda로 바뀌면서 달라지는 점

기존:

- EC2에서 `python main.py`
- PM2가 프로세스 유지
- Worker가 계속 살아 있으면서 SQS를 long polling

변경 후:

- SQS가 Lambda를 직접 호출
- Lambda가 message batch를 처리한 뒤 종료
- PM2 Worker 프로세스는 더 이상 필수가 아님

## 꼭 알아야 하는 AWS 조건

Lambda가 RDS에 붙으려면 아래가 필요합니다.

1. Lambda를 RDS가 있는 VPC 안에 넣기
2. Lambda에 private subnet 연결
3. Lambda security group이 RDS 접근 가능해야 함
4. Lambda execution role에 기본 CloudWatch Logs 권한 + VPC 권한 필요

즉, Lambda 함수만 만드는 것으로 끝나지 않습니다.
`VPC / subnet / security group` 연결이 가장 중요한 부분입니다.

현재 Moodot AWS에서 확인한 값:

- VPC: `vpc-0af82ef9795226607`
- EC2 subnet: `subnet-096bccf9e9fbfc4b5`
- RDS subnet group:
  - `subnet-02657190619de69c9`
  - `subnet-0c727ecc273854028`
  - `subnet-0b928decb88679421`
  - `subnet-096bccf9e9fbfc4b5`
- EC2 security group: `sg-0b30299bcbe9d128d`
- RDS security group: `sg-0f4e2af71015e83a9`

주의:

- RDS security group이 현재 꽤 넓게 열려 있습니다.
- Lambda를 빨리 붙이는 것 자체는 가능하지만, 장기적으로는 Lambda 전용 security group을 따로 만들고
  RDS inbound를 `5432`만 허용하는 식으로 좁히는 것이 좋습니다.

## 필요한 환경변수

Lambda에 넣을 값:

```env
LOG_LEVEL=INFO
WORKER_DATA_PROVIDER=rds
WORKER_EVENT_SOURCE=sqs
DB_HOST=database-1.cne0o00q014x.ap-northeast-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=...
DATABASE_SSL=true
DB_POOL_MAX_SIZE=2
MEMORY_TEXT_ENCRYPTION_KEY=...
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/355222350664/moodot-ai-worker-events
SQS_REGION=ap-northeast-2
SQS_WAIT_TIME_SECONDS=20
SQS_MAX_MESSAGES=5
```

## 실제 전환 순서

### 1. Lambda 함수 생성

위치: AWS 콘솔

- Lambda
- 함수 생성
- Runtime: Python 3.11 권장
- Handler: `lambda_handler.handler`

### 2. 코드 업로드

위치: 로컬 맥

압축 대상:

- `service/` 내부 코드 전체
- 의존성 설치 결과물

레포에 준비된 스크립트:

```bash
./service/build_lambda_package.sh
```

생성 결과:

- zip 파일: `service/dist-lambda/moodot-ai-worker-lambda.zip`

이 zip을 Lambda 코드 업로드에 사용하면 됩니다.

### 3. VPC 연결

위치: AWS 콘솔

- Lambda 함수 설정
- VPC
- RDS와 같은 VPC `vpc-0af82ef9795226607` 선택
- RDS subnet group 안의 subnet 선택
- Lambda용 security group 선택 또는 생성

처음엔 빠르게 테스트하려면:

- 기존 RDS subnet group에 포함된 subnet 2개 이상 선택
- security group은 새로 만드는 것을 권장

예시 방향:

- Lambda SG: outbound all
- RDS SG inbound: `tcp 5432` from Lambda SG

### 4. IAM Role 확인

위치: AWS 콘솔

Lambda role에 필요:

- CloudWatch Logs 권한
- VPC ENI 생성 권한
- 필요 시 Secrets Manager 사용 권한

SQS trigger를 붙이는 데 별도 polling 코드는 필요 없습니다.

### 5. SQS 트리거 연결

위치: AWS 콘솔

- Lambda 함수
- 트리거 추가
- SQS
- `moodot-ai-worker-events`
- Batch size는 작게 시작: `1~5`
- partial batch response 사용 권장

### 6. 테스트

확인할 것:

- 새 기록 생성
- Lambda CloudWatch 로그 확인
- `public.memories.processed=true`
- `public.interventions` 생성 여부
- DLQ 누적 여부

## 네가 해야 할 것

AWS 콘솔에서 직접 확인/선택이 필요한 부분:

- Lambda 함수 생성
- VPC / subnet / security group 연결
- Lambda role 확인
- SQS trigger 연결
- CloudWatch 로그 확인

## 내가 이어서 할 수 있는 것

- Lambda 배포용 zip 구조 정리
- 업로드 스크립트 만들기
- Lambda용 build/deploy 문서 보강
- PM2 Worker를 Lambda 전환 후 어떻게 끌지 운영 순서 정리

현재 이 문서 기준으로는 zip 생성 스크립트까지 준비된 상태입니다.
