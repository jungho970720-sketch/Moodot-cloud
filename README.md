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

The app now follows this primary request flow in the EC2 practice deployment:

```text
Browser -> Nginx HTTPS -> Next.js frontend -> Express backend -> RDS PostgreSQL
```

New memory creation can also enqueue a lightweight `memory.created` event to SQS
when the backend has `AI_EVENT_QUEUE_URL` configured. The AI Worker can consume
that queue with `WORKER_EVENT_SOURCE=sqs`, while RDS polling stays as a recovery
fallback.

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
MEMORY_TEXT_ENCRYPTION_KEY=
NEXT_PUBLIC_API_BASE_URL=
FRONTEND_ORIGIN=
NEXT_PUBLIC_AUTH_PROVIDER=
AUTH_PROVIDER=
NEXT_PUBLIC_COGNITO_DOMAIN=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
COGNITO_DOMAIN=
COGNITO_CLIENT_ID=
COGNITO_REGION=
COGNITO_USER_POOL_ID=
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
DATABASE_SSL=
S3_BUCKET=
S3_REGION=
AI_EVENT_QUEUE_URL=
SQS_REGION=
```

See [docs/architecture.md](/Users/jungho/Moodot-cloud/docs/architecture.md) for
more detail on how these are used.

## Deployment notes

- Current practice domain: `https://mood-ot.com`
- Frontend process name: `moodot-fe`
- Backend process name: `moodot-be`
- PM2 process list should be saved with `pm2 save` after restart changes.
- PM2 must be registered with systemd as `pm2-ubuntu` so FE/BE processes are resurrected after EC2 reboot.
- Elastic IP is used to keep the public address stable across restarts.

Typical EC2 deployment check:

```bash
# EC2 terminal
cd ~/Moodot-cloud
npm run build
pm2 restart moodot-fe --update-env

cd ~/Moodot-cloud/backend
npm run build
pm2 restart moodot-be --update-env

pm2 list
systemctl status pm2-ubuntu --no-pager
curl -I https://mood-ot.com
curl https://mood-ot.com/health
pm2 save
```

## Project docs

- [Architecture](/Users/jungho/Moodot-cloud/docs/architecture.md)
- [Memory API](/Users/jungho/Moodot-cloud/docs/memory-api.md)
- [Memory text encryption migration](/Users/jungho/Moodot-cloud/docs/memories_text_encryption.sql)
- [AI events](/Users/jungho/Moodot-cloud/docs/service/events.md)
- [Database schema](/Users/jungho/Moodot-cloud/docs/service/database-schema.md)

## Framework docs

- [Next.js Documentation](https://nextjs.org/docs)
