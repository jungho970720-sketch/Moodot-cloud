# Moodot Backend

Moodot memories API를 Next.js API Route 밖에서 실행하기 위한 Express 서버입니다.

## 실행

```bash
cd backend
npm install
npm run dev
```

기본 포트는 `4000`입니다.

## 필요한 환경변수

루트의 `.env.local`을 먼저 읽고, `backend/.env`가 있으면 그 값으로 덮어씁니다.

```env
MEMORY_TEXT_ENCRYPTION_KEY=
FRONTEND_ORIGIN=http://localhost:3000
PORT=4000
DB_HOST=
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=
DATABASE_SSL=true
S3_BUCKET=
S3_REGION=ap-northeast-2
AI_EVENT_QUEUE_URL=
SQS_REGION=ap-northeast-2
```

`S3_BUCKET`과 `S3_REGION`이 있으면 새 이미지 업로드는 S3를 사용하고, DB의
`image_url`에는 `s3/{userId}/{fileName}` 형태의 경로를 저장합니다.

`AI_EVENT_QUEUE_URL`과 `SQS_REGION`이 있으면 새 기록 저장 성공 후 AI Worker용
`memory.created` 이벤트를 SQS로 보냅니다. 값이 없으면 SQS 전송은 건너뛰고,
기존 RDS polling 기반 Worker 처리는 그대로 동작합니다.

프론트엔드에서 이 서버를 사용하려면 루트 `.env.local`에 아래 값을 추가합니다.

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```
