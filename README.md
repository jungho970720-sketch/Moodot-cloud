# Moodot

Moodot is an emotional journaling app that is being split into independent
frontend, backend, and AI responsibilities for cloud deployment practice.

## Current structure

- `frontend`: Next.js user interface
- `backend`: Express API under [`backend/`](/Users/jungho/Moodot-cloud/backend)
- `ai worker`: Python service under [`service/`](/Users/jungho/Moodot-cloud/service)

Current architecture notes are documented in
[docs/architecture.md](/Users/jungho/Moodot-cloud/docs/architecture.md).

## Current status

The main FE/BE split has already been applied to these domains:

- `memories`
- `collections`
- `interventions`
- `ai-insight` state lookup
- image upload / signed URL flow

The app now follows this primary request flow:

```text
Frontend -> Backend API -> Supabase
```

## Local development

Install root dependencies:

```bash
npm ci
```

Install backend dependencies:

```bash
npm --prefix backend install
```

Run the frontend:

```bash
npm run dev
```

Run the backend in a separate terminal:

```bash
cd backend
npm run dev
```

Local ports:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

## Environment variables

Core variables used by the current split runtime:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MEMORY_TEXT_ENCRYPTION_KEY=
NEXT_PUBLIC_API_BASE_URL=
FRONTEND_ORIGIN=
```

See [docs/architecture.md](/Users/jungho/Moodot-cloud/docs/architecture.md) for
more detail on how these are used.

## Deployment notes

- Frontend process name: `moodot`
- Backend process name: `moodot-backend`
- PM2 auto-start has been configured for EC2 runtime recovery
- Elastic IP is used to keep the public address stable across restarts

## Project docs

- [Architecture](/Users/jungho/Moodot-cloud/docs/architecture.md)
- [Memory API](/Users/jungho/Moodot-cloud/docs/memory-api.md)
- [Memory text encryption migration](/Users/jungho/Moodot-cloud/docs/memories_text_encryption.sql)
- [AI events](/Users/jungho/Moodot-cloud/docs/service/events.md)
- [Database schema](/Users/jungho/Moodot-cloud/docs/service/database-schema.md)

## Framework docs

- [Next.js Documentation](https://nextjs.org/docs)
