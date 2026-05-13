# AWS Supabase Replacement Plan

Moodot의 Supabase 의존성은 한 번에 제거하지 않고 단계적으로 줄인다.

## 현재 1단계

- Auth는 `NEXT_PUBLIC_AUTH_PROVIDER` 값으로 `supabase` 또는 `cognito`를 선택한다.
- `supabase`일 때는 기존 Supabase Auth 흐름을 그대로 사용한다.
- `cognito`일 때는 AWS Cognito Hosted UI로 Google 로그인을 진행하고, `/auth/callback`에서 토큰을 쿠키에 저장한다.
- 백엔드는 Cognito JWT를 검증한 뒤, 임시 호환 모드로 Supabase DB를 service key로 조회한다.

즉, 이 단계는 “로그인 입구를 AWS Cognito로 바꾸는 작업”이고 DB와 Storage는 아직 Supabase에 남아 있다.

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
   - EC2: `http://Elastic-IP:3000/auth/callback`
   - 나중에 도메인을 붙이면 `https://도메인/auth/callback`
6. Sign-out URL 등록
   - 로컬: `http://localhost:3000/login`
   - EC2: `http://Elastic-IP:3000/login`

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
```

## 다음 단계

1. RDS PostgreSQL을 만들고 Supabase 테이블 구조를 옮긴다.
2. 백엔드의 Supabase query builder 코드를 SQL/ORM 기반 코드로 교체한다.
3. Supabase Storage를 S3로 옮긴다.
4. AI Worker의 Supabase Realtime 의존성을 SQS/EventBridge 기반으로 바꾼다.

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

Supabase Storage는 `memory-images` 버킷을 사용한다. 이 부분은 RDS가 아니라 S3 전환 대상이다.

## RDS 이전 우선순위

1. `memories`
   - 기록 저장/조회가 앱의 핵심 기능이다.
   - Cognito `sub` 값을 `user_id`로 저장하는 기준을 먼저 확정한다.
2. `collections`, `collection_memories`
   - 기록 묶음 기능이다.
   - `memories`가 먼저 옮겨져야 안전하다.
3. `interventions`, `intervention_feedback`
   - AI Worker와 연결되는 기능이다.
   - RDS 이전 후에는 Worker 이벤트 흐름도 같이 바꿔야 한다.
4. `emotion_categories`
   - 기준 데이터 성격이 강하다.
   - RDS 초기 seed 데이터로 관리하는 편이 좋다.

## 다음 실무 작업

1. Supabase에서 현재 테이블 구조를 확인한다.
   - Supabase SQL Editor에서 `memories`, `collections`, `collection_memories`, `interventions`, `intervention_feedback`, `emotion_categories`의 컬럼/타입을 확인한다.
   - RDS 초안은 `docs/rds-schema-draft.sql`에 있다. 실제 Supabase 구조와 비교 후 보정한다.
2. RDS PostgreSQL을 만든다.
   - 처음에는 Free tier 또는 가장 작은 인스턴스로 시작한다.
   - EC2 백엔드에서 접근할 수 있도록 같은 VPC/보안그룹을 맞춘다.
3. 백엔드에 PostgreSQL 클라이언트를 추가한다.
   - 후보: `pg` 또는 Prisma.
   - 현재 코드는 Express API라 `pg`로 시작하는 것이 변경 범위가 작다.
4. 먼저 `memories` API만 RDS로 바꿔 테스트한다.
   - `GET /api/memories`
   - `POST /api/memories`
   - `GET /api/memories/:id`
   - `PATCH /api/memories/:id`
   - `DELETE /api/memories/:id`
