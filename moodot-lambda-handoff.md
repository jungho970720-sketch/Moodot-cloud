# Moodot Lambda Handoff

## 기본 정보

- 레포 경로: `/Users/jungho/Moodot-cloud`
- 브랜치: `codex/aws-cognito-auth-foundation`
- 서비스 도메인: `https://mood-ot.com`

## 현재 서비스 구조

- FE: Next.js
- BE: Express (`backend/`)
- AI Worker: Python (`service/`)
- DB: RDS PostgreSQL
- Auth: AWS Cognito + Google 로그인
- Storage: S3
- Queue: SQS

## 지금까지 완료된 것

### 기존 배포 / 기능

- Route 53 도메인 연결 완료
- HTTPS / Nginx 설정 완료
- Cognito Hosted UI + Google 로그인 연동 완료
- RDS PostgreSQL 저장 확인 완료
- 기록 저장 / 기록 조회 확인 완료
- 컬렉션 생성 및 기록 연결 / 조회 완료
- S3 이미지 저장 기능 추가 및 배포환경 확인 완료

### 비용 관련 정리

- 불필요한 ALB / 대상 그룹 삭제 진행
- EC2 / RDS 온오프용 맥 `.command` 파일 생성

### SQS 기반 AI Worker 연결

- SQS 큐 생성: `moodot-ai-worker-events`
- DLQ 생성: `moodot-ai-worker-events-dlq`
- EC2 IAM Role에 SQS 권한 추가 완료
- 백엔드에서 기록 생성 시 `memory.created` 이벤트를 SQS에 넣도록 구현 완료
- 기존 AI Worker가 SQS 메시지를 읽도록 구현 완료
- EC2 배포환경에서 SQS 흐름 smoke test 완료

### Lambda 전환 작업

- Lambda 함수 생성 완료: `moodot-ai-worker-lambda`
- Handler 설정 완료: `lambda_handler.handler`
- Lambda VPC / subnet 연결 완료
- Lambda 환경변수 설정 완료
- Lambda 실행 role에 SQS 권한 추가 완료
- SQS event source mapping 연결 완료
- Lambda가 실제로 기록 저장 후 호출되는 것 확인 완료
- CloudWatch에서 새 로그 스트림 생성 확인 완료
- `START / END / REPORT` 로그 확인 완료
- 기존 `GLIBC_2.28` 오류 해결 완료

## Lambda 오류 해결 내용

문제:

- `cryptography` 패키지가 Lambda 런타임과 맞지 않는 glibc로 빌드되어 `GLIBC_2.28 not found` 오류 발생

해결:

- Lambda 패키지 빌드 이미지를 `python:3.11-slim`에서 `public.ecr.aws/lambda/python:3.11`로 변경
- `tiktoken`은 실제 사용하지 않아 제거
- Lambda zip 재생성 후 재업로드
- 이후 CloudWatch에서 ImportError 없이 정상 실행 확인

## 현재 확인된 정상 상태

- 기록 저장됨
- 홈 최근 기록에 반영됨
- `/records` 목록에 반영됨
- `/memory/17` 상세 페이지 조회됨
- SQS 메인 큐 메시지 0
- DLQ 메시지 0
- Lambda 실행 시 에러 없이 `START / END / REPORT` 확인됨

즉 현재는 아래 흐름까지는 정상 연결된 상태입니다.

```text
기록 저장 -> SQS -> Lambda 호출
```

## Lambda 전환 최종 검증 완료 (2026-06-07)

### 검증 결과

- DB `public.interventions` 에 Lambda가 생성한 row 확인 완료:
  - `id=4, reason=positive_reinforcement, status=shown, created_at=2026-06-07`
- CloudWatch 상세 로그 확인 완료:
  - RDS 연결 성공
  - OpenAI(gpt-4o-mini) 연결 성공
  - SQS 메시지 수신 및 파싱 정상
  - 규칙 엔진 정상 동작 (`frequency_limit` 차단 포함)
- PM2 `moodot-ai-worker` 중지 및 삭제 완료 → Lambda가 완전 대체

### 로그 수정 내용

- `service/runtime.py` `configure_logging()` 수정
  - Lambda 런타임이 root logger를 미리 등록하기 때문에 `basicConfig()`가 no-op이 되는 문제 수정
  - `logging.getLogger().setLevel(level)` 추가로 LOG_LEVEL 환경변수가 Lambda에서도 반영되도록 함
  - Lambda zip 재빌드 및 재업로드 완료

### 현재 AI Worker 구조

- **Lambda** `moodot-ai-worker-lambda` — SQS 트리거, 기록 생성 시 자동 실행
- **PM2 AI Worker** — 중지 및 삭제 완료 (Lambda로 대체)
- **RDS polling fallback** — Lambda 내부에서 initial_check/periodic_check는 제거됨, SQS 전용

### 전체 흐름 (최종 확인)

```text
기록 저장 → backend SQS enqueue → Lambda 호출 → 규칙 엔진 → intervention 생성 → FE 표시
```

## 관련 코드 변경 포인트

### AI Worker Lambda 관련 파일

- `service/lambda_handler.py`
- `service/runtime.py`
- `service/events/sqs.py`

### Lambda 패키징 관련

- `service/build_lambda_package.sh`
- `service/requirements.txt`

### 문서

- `docs/ai-worker-lambda-migration.md`
- `service/README.md`

## 최근 커밋

- `550459d feat: prepare ai worker lambda handler`
- `55cf07d docs: add lambda packaging guide`
- `8529ffe feat: prepare lambda sqs worker deployment`
- `456ccab fix: rebuild lambda package in aws runtime`

## 현재 브랜치 상태

- 원격 push 완료
- 개인용 `scripts/` 폴더는 untracked 상태
- `scripts/`는 개인 온오프 파일이라 커밋 대상 아님

## 다음 작업 추천

1. ~~Lambda 실행 후 DB에 intervention 생성 여부 확인~~ ✅ 완료
2. ~~기존 PM2 AI Worker를 Lambda로 대체~~ ✅ 완료
3. 비용 절감: 테스트 후 EC2/RDS 중지 (Lambda는 서버리스라 별도 중지 불필요)
4. Lambda 전용 Security Group 분리 검토 (현재는 EC2와 동일 SG 사용)
5. OpenAI 크레딧 소진 모니터링
6. 신규 기능 개발
