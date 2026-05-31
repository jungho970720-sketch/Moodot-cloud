# AWS Supabase Replacement Plan

Moodot의 Supabase 의존성은 한 번에 제거하지 않고 단계적으로 줄인다.

## 현재 상태

- 배포 도메인 `https://mood-ot.com`을 Route 53과 Nginx HTTPS로 연결했다.
- Cognito Hosted UI와 Google 로그인을 연결했다.
- Cognito App Client는 secret 없는 SPA 클라이언트를 사용한다.
- EC2에서는 PM2로 `moodot-fe`, `moodot-be`를 실행한다.
- `memories` 저장/조회는 RDS PostgreSQL의 `public.memories` 테이블까지 검증했다.
- `collections`, `collection_memories`도 RDS PostgreSQL에서 생성/연결/조회까지 검증했다.
- 새 이미지 업로드는 S3 버킷 `moodot-memory-images-jungho-2026`에 `.webp` 객체가 생성되는 것까지 검증했다.
- 사이트의 memory detail 페이지에서 S3 이미지 signed URL 조회도 확인했다.
- RDS 저장 확인은 EC2 터미널에서 SQL 조회로 확인한다.

```sql
select id, user_id, title, created_at
from public.memories
order by created_at desc
limit 5;
```

## 기존 1단계 기록

- Auth는 `NEXT_PUBLIC_AUTH_PROVIDER` 값으로 `supabase` 또는 `cognito`를 선택한다.
- `supabase`일 때는 기존 Supabase Auth 흐름을 그대로 사용한다.
- `cognito`일 때는 AWS Cognito Hosted UI로 Google 로그인을 진행하고, `/auth/callback`에서 토큰을 쿠키에 저장한다.
- 백엔드는 Cognito JWT를 검증한 뒤, PostgreSQL 환경변수가 있으면 RDS를 사용한다.

즉, 이 단계는 “로그인 입구를 AWS Cognito로 바꾸고, 핵심 기록/컬렉션 저장을 RDS로 옮기고, 신규 이미지 저장을 S3로 옮기는 작업”이다. AI Worker와 intervention 관련 일부 API 의존성은 아직 별도 전환 대상이다.

## AWS 콘솔에서 필요한 Cognito 설정

1. Cognito User Pool 생성
2. App client 생성
   - Client secret은 사용하지 않는 설정이 간단하다.
   - OAuth flow는 Authorization code grant를 사용한다.
   - Scope는 `openid`, `email`, `profile`을 사용한다.
3. Hosted UI 도메인 설정
4. Google identity provider 연결
5. Callback URL 등록
   - 로컬: `http://localhost:3000/auth/callback`
   - 배포: `https://mood-ot.com/auth/callback`
6. Sign-out URL 등록
   - 로컬: `http://localhost:3000/login`
   - 배포: `https://mood-ot.com/login`

## 로컬 또는 EC2 환경변수

```env
NEXT_PUBLIC_AUTH_PROVIDER=cognito
AUTH_PROVIDER=cognito

NEXT_PUBLIC_COGNITO_DOMAIN=https://your-domain.auth.ap-northeast-2.amazoncognito.com
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-cognito-app-client-id
COGNITO_DOMAIN=https://your-domain.auth.ap-northeast-2.amazoncognito.com
COGNITO_CLIENT_ID=your-cognito-app-client-id
COGNITO_REGION=ap-northeast-2
COGNITO_USER_POOL_ID=ap-northeast-2_xxxxxxxxx

NEXT_PUBLIC_SUPABASE_URL=your-supabase-url-here
SUPABASE_SERVICE_KEY=your-supabase-service-key-here

DB_HOST=database-1.cne0o00q014x.ap-northeast-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-rds-password
DATABASE_SSL=true
FRONTEND_ORIGIN=https://mood-ot.com,http://localhost:3000

S3_BUCKET=moodot-memory-images-jungho-2026
S3_REGION=ap-northeast-2
```

배포 환경에서는 `NEXT_PUBLIC_API_BASE_URL=https://mood-ot.com`으로 두고, Nginx가 `/api/` 요청을 백엔드 `127.0.0.1:4000`으로 프록시한다.

## 다음 단계

1. `interventions`, `intervention_feedback` 백엔드 API의 RDS SQL 경로를 EC2에 배포하고 검증한다.
2. AI Worker가 읽고 쓰는 `memories`, `interventions`, `intervention_feedback`, `emotion_categories` 접근을 RDS로 옮긴다.
3. AI Worker의 Supabase Realtime 의존성을 SQS/EventBridge 기반으로 바꾼다.
4. Supabase fallback 코드 제거 범위를 정리한다.

## RDS 전환을 위한 DB 사용 지도

현재 백엔드와 AI Worker가 직접 의존하는 Supabase 테이블은 다음과 같다.

| 테이블 | 현재 사용 위치 | 역할 |
| --- | --- | --- |
| `memories` | `backend/src/routes/memories.ts`, `backend/src/routes/collections.ts`, `backend/src/routes/interventions.ts`, `service/main.py`, `service/tools/emotion_tools.py` | 사용자의 감정 기록 원본 |
| `collections` | `backend/src/routes/collections.ts` | 기록 묶음/컬렉션 |
| `collection_memories` | `backend/src/routes/collections.ts` | 컬렉션과 기록의 연결 테이블 |
| `interventions` | `backend/src/routes/interventions.ts`, `service/tools/intervention_tools.py`, `service/models/intervention_repository.py` | AI Worker가 생성하는 개입 메시지 |
| `intervention_feedback` | `backend/src/routes/interventions.ts`, `service/main.py`, `service/scoring/feedback_scorer.py` | 사용자의 개입 피드백 |
| `emotion_categories` | `service/agents/pipeline.py`, `service/tools/emotion_tools.py` | 감정 ID와 감정 카테고리 매핑 |

기존 Supabase Storage는 `memory-images` 버킷을 사용했다. 현재 신규 업로드는 S3로 저장하며, 기존 Supabase Storage 경로는 호환을 위해 signed URL fallback으로 남겨 둔다.

## RDS 이전 우선순위

1. `memories`
   - 기록 저장/조회가 앱의 핵심 기능이다.
   - Cognito `sub` 값을 `user_id`로 저장하는 기준을 먼저 확정한다.
   - Supabase의 `auth.users(id)` 외래키는 RDS에 그대로 옮기지 않는다. Cognito를 인증 원천으로 쓰기 때문이다.
2. `collections`, `collection_memories`
   - 기록 묶음 기능이다.
   - `memories`가 먼저 옮겨져야 안전하다.
3. `interventions`, `intervention_feedback`
   - AI Worker와 연결되는 기능이다.
   - RDS 이전 후에는 Worker 이벤트 흐름도 같이 바꿔야 한다.
4. `emotion_categories`
   - 기준 데이터 성격이 강하다.
   - RDS 초기 seed 데이터로 관리하는 편이 좋다.

## 완료된 실무 작업

1. RDS PostgreSQL 생성 및 EC2 접근 설정.
2. 백엔드에 `pg` 기반 PostgreSQL 경로 추가.
3. `memories` API RDS 전환.
   - `GET /api/memories`
   - `POST /api/memories`
   - `GET /api/memories/:id`
   - `PATCH /api/memories/:id`
   - `DELETE /api/memories/:id`
4. `collections`, `collection_memories` API RDS 전환.
5. S3 이미지 업로드 및 signed URL 조회 경로 추가.
6. `interventions`, `intervention_feedback` 백엔드 API에 RDS SQL 경로 추가.

## 다음 실무 작업

1. EC2 터미널에서 최신 코드를 받은 뒤 백엔드를 빌드/재시작하고 intervention API를 검증한다.
2. AI Worker의 RDS polling 모드를 실제 RDS 환경변수로 실행 검증한다.
3. AI Worker의 실시간 이벤트 흐름을 SQS/EventBridge 기반으로 분리한다.
4. EC2에서 PM2 중복 프로세스를 확인한 뒤, 변경 배포 시 `pm2 restart ... --update-env`와 `pm2 save`를 수행한다.
5. EC2 재부팅 후 자동 복구를 위해 `pm2-ubuntu.service`가 enabled/active인지 확인한다.

## AI Worker RDS 전환 메모

- `WORKER_DATA_PROVIDER=rds`를 설정하면 AI Worker는 Supabase Realtime 구독 대신 RDS PostgreSQL polling 모드로 동작한다.
- polling 모드는 `public.memories`의 `processed=false` 기록을 주기적으로 조회하고, 개입 생성 후 `processed=true`로 바꾼다.
- Worker가 직접 사용하는 `memories`, `emotion_categories`, `interventions`, `intervention_feedback` 조회/저장 경로에 RDS store를 추가했다.
- 이 단계는 SQS/EventBridge 전환 전의 중간 단계다. 실시간성은 약해지지만 Supabase 데이터 의존을 줄이는 안전한 발판이다.

## 2026-05-31 AI Worker RDS smoke test

- 로컬 맥에서 RDS 직접 연결은 timeout이 발생했다. RDS 보안그룹이 EC2 접근 중심으로 잡혀 있기 때문으로 본다.
- EC2 내부 `/tmp/moodot-service-rds-smoke`에서 Worker RDS store smoke test를 실행했다.
- EC2에 `python3-pip`를 설치하고, 사용자 영역에 `asyncpg`를 설치했다.
- 결과: RDS 연결 성공, `processed=false` memories 조회 성공, `emotion_categories` 조회 성공, 최근 감정 조회 성공.
- 이 smoke test는 읽기 전용으로 수행했고, `processed` 값이나 `interventions` 데이터는 변경하지 않았다.

## 2026-05-31 AI Worker RDS write smoke test

- EC2 내부에서 테스트용 UUID user와 memory row를 임시 생성했다.
- `InterventionRepository`가 RDS store를 통해 `public.interventions` row를 생성하는 것을 확인했다.
- `mark_memory_processed()`가 테스트 memory의 `processed` 값을 `true`로 변경하는 것을 확인했다.
- `intervention_feedback` 테스트 row를 넣고 `calculate_feedback_score()` / `save_feedback_score()`가 `feedback_score=2`를 저장하는 것을 확인했다.
- 테스트로 생성한 `intervention_feedback`, `interventions`, `memories` row는 검증 직후 삭제했다.

## 2026-05-31 운영 점검 기록

- `https://mood-ot.com/health`가 502를 반환했다.
- 원인은 EC2 인스턴스와 Nginx는 살아 있었지만 `moodot-fe`, `moodot-be` PM2 프로세스가 사라진 상태였다.
- EC2 터미널에서 `pm2 start npm --name moodot-fe -- start`, `pm2 start npm --name moodot-be -- start`, `pm2 save`로 복구했다.
- `pm2-ubuntu.service`가 없어서 재부팅 자동 복구가 되지 않는 상태였고, `pm2 startup systemd -u ubuntu --hp /home/ubuntu`로 systemd 등록을 완료했다.
- PM2를 systemd 관리 상태로 전환한 뒤 `pm2-ubuntu.service`는 enabled/active 상태가 됐다.
- 백엔드 `FRONTEND_ORIGIN`에 `https://www.mood-ot.com`이 빠져 있어 CORS 에러가 있었고, EC2 `backend/.env`를 수정한 뒤 `pm2 restart moodot-be --update-env`로 반영했다.
- 최종 확인: `/health`는 `{"ok":true}`, `/health/db`는 `{"ok":true,"db":"postgres"}`로 응답했다.
