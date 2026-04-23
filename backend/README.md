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
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
MEMORY_TEXT_ENCRYPTION_KEY=
FRONTEND_ORIGIN=http://localhost:3000
PORT=4000
```

프론트엔드에서 이 서버를 사용하려면 루트 `.env.local`에 아래 값을 추가합니다.

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```
