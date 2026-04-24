# Moodot Architecture

## 1. Current deployment structure

Moodot is currently split into three responsibilities:

- `FE`: Next.js app for the user interface
- `BE`: Express backend for API orchestration
- `AI`: Python worker under `service/`

The frontend no longer needs to call Supabase directly for the main separated domains. Instead, it talks to the backend API, and the backend communicates with Supabase.

```mermaid
flowchart LR
    U["User Browser"] --> FE["Frontend: Next.js"]
    FE --> BE["Backend: Express API"]
    BE --> SB["Supabase DB/Auth/Storage"]
    SB --> AI["AI Worker: Python service"]
```

At runtime, the frontend and backend are managed as separate PM2 processes:

- `moodot`
- `moodot-backend`

## 2. Separated domains

The following domains are already moved to the backend API layer:

- `memories`
- `collections`
- `interventions`
- `ai-insight` state lookup
- image upload / signed URL flow

This means the main access pattern is now:

```text
Frontend -> Backend API -> Supabase
```

instead of:

```text
Frontend -> Supabase directly
```

## 3. Runtime ports

Local development:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

EC2 deployment:

- Frontend: `http://<elastic-ip>:3000`
- Backend: `http://<elastic-ip>:4000`

PM2 process names:

- `moodot`
- `moodot-backend`

## 4. Environment variables

Frontend / backend runtime currently depend on these core variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MEMORY_TEXT_ENCRYPTION_KEY=
NEXT_PUBLIC_API_BASE_URL=
FRONTEND_ORIGIN=
```

Notes:

- `NEXT_PUBLIC_API_BASE_URL` must match the backend address used by the frontend.
- `FRONTEND_ORIGIN` must match the frontend origin allowed by the backend CORS config.
- `MEMORY_TEXT_ENCRYPTION_KEY` is required for encrypted memory text read/write.

## 5. CI workflow split

GitHub Actions are split by responsibility:

- `ai-worker-ci.yml`: runs only when `service/**` changes
- `fe-be-ci.yml`: runs for frontend/backend changes and ignores `service/**`

This prevents FE/BE pushes from unnecessarily triggering AI image build logic.

## 6. Remaining work

The architecture is in a strong "phase 1 complete" state, but not fully finished yet.

Remaining candidates:

- Finalize OAuth redirect strategy for EC2 / Elastic IP
- Deploy AI worker through ECS or another isolated runtime
- Add production deployment steps to the new CI workflows

## 7. Verification completed

The following checks have already been verified during deployment work:

- frontend and backend run independently on EC2
- `memories`, `collections`, `interventions`, and `ai-insight` state calls work through the backend
- PM2 auto-start restores both processes after EC2 reboot
- Elastic IP keeps the public endpoint stable across instance restarts

## 8. Why this structure

This split improves:

- maintainability: UI and API responsibilities are clearer
- deployability: frontend and backend can be restarted independently
- portfolio value: the project shows explicit FE/BE/AI separation instead of a single bundled app
- future migration flexibility: Supabase can remain as the data platform while the app logic moves into our own backend
