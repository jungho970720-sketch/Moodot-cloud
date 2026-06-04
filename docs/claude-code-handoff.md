# Moodot Cloud Migration Handoff

Moodot 개인 클라우드 이관 작업을 Claude Code에서 이어서 진행하기 위한 인수인계 문서입니다.

## 기본 정보

- 로컬 레포: `/Users/jungho/Moodot-cloud`
- 브랜치: `codex/aws-cognito-auth-foundation`
- 배포 도메인: `https://mood-ot.com`
- EC2 Elastic IP: `15.164.114.242`
- EC2 인스턴스: `i-0dede142831921e17`
- RDS PostgreSQL endpoint: `database-1.cne0o00q014x.ap-northeast-2.rds.amazonaws.com`
- S3 버킷: `moodot-memory-images-jungho-2026`
- FE: Next.js
- BE: `backend/` Express
- AI Worker: `service/`
- PM2 프로세스명:
  - `moodot-fe`
  - `moodot-be`

## 최근 커밋

- `24e072a docs: record ai worker rds write smoke test`
- `a055929 docs: record ai worker rds smoke test`
- `96ac29e feat: add rds polling mode for ai worker`
- `69a56ae feat: add rds intervention support`
- `938a1f5 feat: add s3 image storage support`

원격 브랜치에 push 완료됨.

## 완료된 작업

### 인프라 / 배포

- Route 53 도메인 연결 완료
- HTTPS/Nginx 설정 완료
- Cognito Hosted UI + Google 로그인 연동 완료
- RDS PostgreSQL 저장 확인 완료
- S3 이미지 저장 기능 추가 완료
- S3 버킷 생성 완료:
  - `moodot-memory-images-jungho-2026`
- EC2 IAM Role 생성 및 연결 완료:
  - `MoodotEc2S3Role`
- S3 업로드 권한 정책 연결 완료
- 이미지 업로드 후 S3에 `.webp` 파일 생성 확인 완료
- 사이트에서도 이미지 조회 확인 완료

### FE/BE 기능

- 기록 저장, 기록 조회 확인 완료
- 컬렉션 생성, 컬렉션에 기록 연결/조회 확인 완료
- `interventions` API RDS SQL 경로 추가 완료
- `interventions` RDS 경로 커밋/push/EC2 백엔드 배포 완료
- 사이트에서 로그인, 기록, 이미지, 컬렉션 정상 동작 확인 완료

### 운영 복구 / 안정화

- 한때 `https://mood-ot.com/health`가 502였음
- 원인:
  - EC2/Nginx는 살아 있었지만 PM2 프로세스 `moodot-fe`, `moodot-be`가 사라진 상태였음
- 조치:
  - EC2에서 `moodot-fe`, `moodot-be` 재시작
  - `pm2 save`
  - `pm2-ubuntu.service`가 없어 재부팅 자동복구가 안 되는 상태였음
  - `pm2 startup systemd -u ubuntu --hp /home/ubuntu`로 systemd 등록 완료
  - PM2를 systemd 관리 상태로 전환 완료
- 현재:
  - `pm2-ubuntu.service` enabled/active
  - `moodot-fe`, `moodot-be` 각각 1개 online

### CORS / env

- EC2 `backend/.env`의 `FRONTEND_ORIGIN`에 `https://www.mood-ot.com`이 빠져 있었음
- 수정 완료:

```env
FRONTEND_ORIGIN=https://mood-ot.com,https://www.mood-ot.com,http://localhost:3000
```

- `pm2 restart moodot-be --update-env`로 반영 완료

### AI Worker RDS 전환

- `service/`에 `WORKER_DATA_PROVIDER=rds` 모드 추가 완료
- Supabase Realtime 대신 RDS polling 기반으로 동작할 수 있는 기반 추가
- 추가 파일:
  - `service/db/postgres.py`
  - `service/db/__init__.py`
- 주요 내용:
  - `processed=false` memories polling
  - `emotion_categories` 조회
  - 최근 감정 조회
  - `interventions` 생성
  - `memories.processed=true` 업데이트
  - `intervention_feedback` 점수 계산
  - `interventions.feedback_score` 저장
- `asyncpg` 의존성 추가
- `DB_POOL_MAX_SIZE=2` 기본값 추가
- Supabase 모드는 기존대로 유지

## AI Worker RDS 검증 결과

### 읽기 smoke test

- 로컬 맥에서 RDS 직접 연결은 timeout 발생
  - RDS 보안그룹이 EC2 접근 중심으로 잡혀 있기 때문으로 추정
- EC2 내부 `/tmp/moodot-service-rds-smoke`에서 Worker RDS store smoke test 실행
- EC2에 설치한 것:
  - `python3-pip`
  - 사용자 영역 `asyncpg`
- 결과:
  - RDS 연결 성공
  - `processed=false` memories 조회 성공
  - `emotion_categories` 조회 성공
  - 최근 감정 조회 성공
- 읽기 전용으로 수행했고 DB 변경 없음

### 쓰기 smoke test

- EC2 내부에서 테스트용 UUID user와 memory row 임시 생성
- 확인한 것:
  - `InterventionRepository`가 RDS store를 통해 `public.interventions` row 생성
  - `mark_memory_processed()`가 테스트 memory의 `processed` 값을 `true`로 변경
  - `intervention_feedback` 테스트 row 삽입
  - `calculate_feedback_score()`가 점수 `2` 계산
  - `save_feedback_score()`가 `feedback_score=2` 저장
- 테스트로 생성한 row는 모두 삭제:
  - `intervention_feedback`
  - `interventions`
  - `memories`

## 현재 정상 확인

- `https://mood-ot.com` -> 200 OK
- `https://mood-ot.com/health` -> `{"ok":true}`
- `https://mood-ot.com/health/db` -> `{"ok":true,"db":"postgres"}`
- 사이트에서 직접 확인 완료:
  - Google 로그인 정상
  - 기록 목록/상세 정상
  - 이미지 업로드/표시 정상
  - 컬렉션 목록/상세 정상

## 검증 명령 결과

로컬에서 통과:

```bash
python3 -m compileall service
python3 -m pytest service/tests/test_units_rules.py service/tests/test_rule_engine.py
```

결과:

- 12 passed

주의:

- 전체 `service/tests/test_units.py`는 기존 `langchain==0.1.0`이 Python 3.14/Pydantic v1과 호환되지 않아 수집 단계에서 막힘
- 이번 변경과 직접 관련 없는 기존 의존성 이슈

## 중요한 설정

### EC2 backend `.env`

```env
DB_HOST=database-1.cne0o00q014x.ap-northeast-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=...
DATABASE_SSL=true

S3_BUCKET=moodot-memory-images-jungho-2026
S3_REGION=ap-northeast-2

FRONTEND_ORIGIN=https://mood-ot.com,https://www.mood-ot.com,http://localhost:3000
```

### AI Worker RDS 모드 env

```env
WORKER_DATA_PROVIDER=rds
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
```

## EC2 접속 관련

SSH 키 직접 접속은 기본적으로 안 됐고, EC2 Instance Connect로 임시 공개키를 등록해서 접속했음.

사용했던 방식:

```bash
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0dede142831921e17 \
  --availability-zone ap-northeast-2c \
  --instance-os-user ubuntu \
  --ssh-public-key file:///Users/jungho/.ssh/id_ed25519.pub \
  --region ap-northeast-2
```

그 다음:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 ubuntu@15.164.114.242
```

## 주의할 점

- PM2에서 `moodot-be`가 중복 실행된 적이 있으므로 항상 `pm2 list` 확인 필요
- 현재는 `pm2-ubuntu.service` 등록 완료
- EC2에서 `git pull`은 GitHub HTTPS 인증 문제로 실패했음
  - 이전 배포 때는 파일 복사/scp와 git bundle 방식으로 맞췄음
  - 원격 GitHub 브랜치에는 최신 커밋 push 완료
- EC2 작업 중 기존 untracked 파일:
  - `Express`
  - `Next.js`
  - `앞으로`
  - `현재`
  는 건드리지 않았음

## 2026-05-31 추가 완료 작업

### AI Worker EC2 PM2 배포

- EC2에 `service/requirements.txt` 전체 설치 완료 (Python 3.10)
- `service/.env.local` 구성 완료 (`WORKER_DATA_PROVIDER=rds`, RDS env, OpenAI env)
- foreground 실행으로 동작 확인:
  - RDS PostgreSQL 연결 성공
  - 놓친 감정 8개 감지 및 처리 성공
  - `positive_streak` 규칙 매칭 → intervention 생성 및 RDS 저장 확인
  - `frequency_limit` 차단 정상 동작
  - OpenAI quota 초과 시 fallback 템플릿 메시지로 대체 동작 확인
- PM2 프로세스 등록 완료:

```bash
pm2 start python3 --name moodot-ai-worker -- main.py
pm2 save
```

- 현재 PM2 프로세스: `moodot-fe`, `moodot-be`, `moodot-ai-worker` 모두 online
- EC2에서 `git pull`이 GitHub HTTPS 인증 문제로 간헐 실패했으나, 재시도로 해결됨

### Supabase 의존성 완전 제거

Supabase → AWS 이관이 완료됨. 코드와 패키지에서 Supabase 의존성 전부 제거함.

#### service/ (Python AI Worker)

- `main.py`: `supabase` import 제거, `create_supabase_client` 제거, Realtime 관련 함수(`subscribe_channels`, `realtime_watchdog`) 제거 → RDS polling 전용
- `tools/intervention_tools.py`, `tools/emotion_tools.py`: Supabase fallback `else` 분기 제거
- `agents/pipeline.py`, `models/intervention_repository.py`: 동일하게 정리
- `scoring/feedback_scorer.py`, `scoring/behavior_adjuster.py`: 동일하게 정리
- `requirements.txt`: `supabase==2.30.0` 제거

#### backend/ (Express)

- `lib/supabase.ts`: `@supabase/supabase-js` import 제거, Cognito 전용으로 단순화, `getSupabaseUserClient` 제거
- `routes/memories.ts`, `routes/collections.ts`, `routes/interventions.ts`: `hasPostgresConfig()` 게이트 제거, RDS 직접 실행
- `routes/storage.ts`: Supabase Storage fallback 제거, S3 전용
- `routes/auth.ts`: `merge-anonymous` 엔드포인트 제거 (Cognito에 익명 유저 없음)
- `index.ts`: `hasPostgresConfig` import 제거
- `backend/package.json`: `@supabase/supabase-js` 제거

#### FE (Next.js)

- `app/api/memories/route.ts`, `app/api/memories/[id]/route.ts`, `app/api/memories/texts/route.ts`: 삭제 (프로덕션에서 사용하지 않는 FE API Route)
- `lib/supabase/auth.ts`: Cognito 전용으로 단순화, Supabase auth 분기 전부 제거
- `lib/supabase/client.ts`, `lib/supabase/server.ts`: 삭제 (미사용)
- `lib/supabase/calendar-records.ts`: 불필요한 Supabase 환경변수 체크 제거
- `app/auth/callback/route.ts`: Supabase callback 경로 제거, Cognito 전용
- `components/layout/auth-init.tsx`: 익명 유저 초기화/병합 로직 제거
- `lib/services/memory.ts`, `lib/services/collection.ts`, `lib/storage/image.ts`: `signInAnonymously`, `getCurrentUser` 호출 제거
- `package.json`: `@supabase/ssr`, `@supabase/supabase-js` 제거

### 현재 서비스 구조

- **Supabase**: 완전히 제거됨
- **Vercel**: 사용하지 않음
- **인증**: AWS Cognito (Google 로그인)
- **데이터**: RDS PostgreSQL
- **이미지**: S3 (`moodot-memory-images-jungho-2026`)
- **배포**: EC2 + Nginx + PM2
- **PM2 프로세스**: `moodot-fe`, `moodot-be`, `moodot-ai-worker`

## 2026-06-02 비용 절감 작업

### 삭제/정리 완료

- 청구서에서 비용이 크던 `Elastic Load Balancing`과 추가 Public IPv4 비용을 확인함
- 삭제한 ALB:
  - `ecs-express-gateway-alb-ea0b2ea4`
- 삭제한 대상 그룹:
  - `ecs-gateway-tg-0a4a24cfcc69d50c3`
  - `ecs-gateway-tg-f2030452bafa83395`
- 삭제 후 확인:
  - 대상 그룹 목록 비어 있음
  - Elastic IP는 Moodot용 `15.164.114.242` 1개만 남음
- 예상 절감:
  - ALB 약 `$16~17/월`
  - ALB가 사용하던 Public IPv4 약 `$15/월`
  - 합계 약 `$30+/월`

### 남은 비용 구조

- RDS:
  - `database-1`
  - `db.t3.micro`
  - 20GB gp3
  - Multi-AZ false
  - Backup retention 0
- EC2:
  - `i-0dede142831921e17`
  - `t3.small`
  - 필요할 때만 시작
- EBS:
  - 8GB 루트 볼륨 1개
- Elastic IP:
  - `15.164.114.242`
  - Moodot 도메인 연결용이므로 삭제 금지
- Registrar:
  - `mood-ot.com` 도메인 등록비 `$15`
  - 일회성 성격의 비용
- ECS:
  - `moodot-ai-worker-ae0c` 서비스가 남아 있음
  - 확인 당시 `Desired=0`, `Running=0`, `LoadBalancers=None`
  - 비용 영향은 거의 없고, 예전 실습 흔적이면 정리 가능

### 비용 절감 운영 문서

RDS/EC2를 필요할 때 켜고, 안 쓸 때 끄는 명령어는 아래 문서에 정리함.

- `docs/aws-cost-operations.md`

## 2026-06-04 로그인/프로필 사용자 정보 개선

### 로그인 계정 선택 문제 해결

- 증상:
  - 로그아웃 후 다시 로그인할 때 Google 계정 선택 화면이 나오지 않고 최근 계정으로 바로 로그인됨
- 조치:
  - Cognito Hosted UI authorize URL의 `prompt`를 `login select_account`로 변경
  - 커밋:
    - `696eaf2 fix: force account selection on cognito login`
- 배포/검증:
  - EC2에 최신 커밋 반영
  - `npm run build` 성공
  - `moodot-fe` PM2 재시작 완료
  - 사이트에서 로그아웃 후 재로그인 시 Google 계정 선택 화면 정상 확인

### 프로필 사용자 정보 반영

- 증상:
  - 프로필 화면에서 이름이 `Google 사용자` 또는 `google_102...` 형태로 표시됨
- 원인:
  - Cognito Google Identity Provider attribute mapping이 `username <- sub`만 설정되어 있었음
  - Cognito 사용자 속성에 `email`, `name`, `picture`가 저장되지 않았음
- 코드 조치:
  - `lib/auth.ts`에서 Cognito `/oauth2/userInfo`를 추가 조회하도록 보강
  - ID 토큰에 정보가 부족해도 access token으로 사용자 정보를 가져와 프로필에 반영
  - 표시 이름 fallback 순서:
    - `name`
    - `given_name + family_name`
    - `nickname`
    - `preferred_username`
    - 이메일 앞부분
  - 커밋:
    - `a42ed4e fix: hydrate cognito profile from userinfo`
- AWS Cognito 설정 조치:
  - User Pool:
    - `User pool - tl-myz`
    - `ap-northeast-2_YmLbFvNSA`
  - Google attribute mapping 수정 완료:

```txt
username <- sub
email    <- email
name     <- name
picture  <- picture
```

- 검증 완료:
  - 로그아웃 후 다시 로그인
  - 프로필에서 사용자 이름 반영 확인
  - 여러 Google 계정 로그인 테스트
  - 사용자별 프로필 정보 반영 확인
  - 사용자별 기록 분리 확인

### Cognito 사용자 확인 위치

AWS 콘솔:

1. Cognito
2. User pools
3. `User pool - tl-myz`
4. Users

로컬 맥 터미널:

```bash
aws cognito-idp list-users \
  --region ap-northeast-2 \
  --user-pool-id ap-northeast-2_YmLbFvNSA
```

## 2026-06-04 사용자별 요청 테스트 보강

### 인증 요청 테스트 추가

- 목적:
  - 여러 사용자가 로그인했을 때 기록/컬렉션 요청이 각자의 Cognito access token을 포함하는지 자동 확인
  - 사용자별 데이터 분리의 프론트 서비스 요청 기반을 회귀 테스트로 보호
- 변경:
  - 기존 `tests/memory-archives/memory-service.test.ts`의 Supabase mock 제거
  - Cognito `getAccessToken` mock 기반으로 테스트 정리
  - `Authorization: Bearer ...` 헤더 포함 여부 테스트 추가
  - `tests/memory-archives/collection-service.test.ts` 추가
- 검증한 서비스:
  - `getMemories`
  - `getMemoryById`
  - `getCollections`
  - `getAvailableMemories`
  - `createCollection`
- 검증 결과:
  - `npm run test:memory-archives` 통과
  - `5 files / 19 tests passed`
  - `npm run build` 통과
- 커밋:
  - `a743c53 test: cover authenticated archive service requests`

## 2026-06-04 AI Worker SQS/EventBridge 전환 준비

- 목적:
  - 현재 AI Worker의 RDS polling 구조를 SQS/EventBridge 기반 이벤트 흐름으로 옮기기 위한 사전 정리
- 문서 추가:
  - `docs/ai-worker-sqs-eventbridge-plan.md`
- 정리 내용:
  - 현재 RDS polling 구조
  - 목표 SQS long polling 구조
  - EventBridge는 이벤트 종류가 늘어난 뒤 확장하는 방향
  - SQS queue/DLQ/IAM 권한 후보
  - backend memory 생성 후 SQS message 전송 방향
  - Worker가 `memory_id`로 RDS를 다시 조회해 처리하는 방향
  - RDS polling fallback 유지 전략
- 추가 정리:
  - `service/README.md`에서 Supabase Realtime 관련 오래된 문구 제거
  - `docs/architecture.md`를 현재 Cognito/RDS/S3/PM2 구조에 맞게 갱신

## 다음으로 할 일

Supabase 이관은 완료됨. 남은 후보 작업:

1. **비용 절감 운영 유지** — 테스트가 끝나면 EC2/RDS를 중지해서 비용 관리
2. **신규 사용자 온보딩/프로필 UX 개선** — 이름/이메일/프로필 이미지 표시 범위 확대
3. **사용자별 기록/컬렉션 통합 테스트 후보** — RDS를 켠 상태에서 실제 DB 격리 테스트 추가 검토
4. **SQS/EventBridge 구현** — 계획 문서 기준으로 SQS 리소스 생성, backend enqueue, Worker consume 구현
5. **OpenAI 크레딧 충전** — AI Worker LLM 메시지 생성 정상 동작 확인
6. **신규 기능 개발**

## Claude Code 요청 문구

Claude Code에서 이어서 시작할 때는 아래처럼 요청하면 됩니다.

```md
Moodot 작업을 이어서 진행하고 싶어.
현재 문서 `docs/claude-code-handoff.md`를 먼저 읽고 현재 상태를 파악한 뒤 진행해줘.
나는 AWS/배포 초급이라 명령어를 줄 때는 어디서 실행하는지(로컬 맥 / EC2 터미널 / AWS 콘솔)를 같이 알려줘.
```
