# Mac Invoices

A full-stack invoice manager for a small landlord operation: a React (Vite) web app, a Fastify API, and PostgreSQL via Prisma. It's an **npm-workspaces monorepo**:

| Workspace | Path | What it is |
|-----------|------|------------|
| `@mac-invoices/web` | `apps/web` | React 19 + Vite frontend |
| `@mac-invoices/api` | `apps/api` | Fastify 5 API (Prisma, Postgres) |
| `@mac-invoices/shared` | `packages/shared` | Zod schemas + types shared by both |

For architecture and conventions see [`CLAUDE.md`](CLAUDE.md), [`PROJECT_PLAN.md`](PROJECT_PLAN.md), [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md), and [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Prerequisites

- **Node 24.x** (see `engines` in `package.json`)
- **Docker** (for local Postgres) — or any Postgres 16 you point `DATABASE_URL` at

## Setup

```bash
# 1. Install dependencies (all workspaces)
npm install

# 2. Configure environment — copy the template and fill it in
cp .env.example .env        # a single root .env is the source of truth

# 3. Start local Postgres (user/pass/db = postgres/postgres/invoices)
docker compose up -d

# 4. Create the schema and seed the landlord + 2025 invoices
npm run db:push
npm run db:seed
```

## Run

```bash
npm run dev          # web dev server (Vite) — proxies /api to the backend
npm run dev:api      # Fastify API on :3000 (run in a second terminal)
```

The web dev server proxies `/api` to the API, so the app calls a same-origin `/api` in every environment.

## Test / quality gate

The **Definition of Done** for any change — also enforced in CI (`.github/workflows/ci.yml`):

```bash
npm run lint && npm run typecheck && npm run test
```

Other useful scripts: `npm run format` (Prettier), `npm run build` (web), `npm run db:reset` (drop + re-seed).

---

## Environment reference

A single root `.env` is loaded by both apps (the API resolves it via `apps/api/src/lib/loadEnv.ts`). Copy `.env.example` and fill in. **Never commit a real `.env`.**

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string. Local default matches docker-compose (`postgres:postgres@localhost:5432/invoices`). |
| `NODE_ENV` | yes | `development` locally; `production` when deployed. |
| `SESSION_SECRET` | yes | Signs/encrypts session cookies. **Set a long, random value in production.** |
| `WEB_ORIGIN` | yes | Allowed browser origin for CORS (credentials enabled). Dev: `http://localhost:5173`. |
| `LANDLORD_USER_ID` | yes | ID of the seeded landlord; invoices are owned by this user until multi-user. |
| `LANDLORD_EMAIL` | yes | Landlord login email (created at seed time). |
| `LANDLORD_PASSWORD` | yes | Landlord login password (hashed at seed time). **The seed refuses the dev default `changeme-dev` in production — set a strong value.** |
| `COOKIE_SECURE` | prod | `true` sends the session cookie only over HTTPS. Set `true` on any non-localhost deploy. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | for export | JSON string of a Google service-account key. Share the target sheet as Editor with its `client_email`. See [`docs/SHEETS_EXPORT.md`](docs/SHEETS_EXPORT.md). |
| `GOOGLE_SHEET_ID` | for export | Default spreadsheet the export appends to (a per-request `spreadsheetId` overrides it). |
| `GOOGLE_SHEET_TAB` | no | Tab the export writes to (default `Invoices`). |
| `EXPORT_RATE_LIMIT_MAX` | no | Export-endpoint rate-limit cap per 15-min window (default `5`). |
| `EXPORT_CHUNK_SIZE` | no | Rows per Sheets append call (default `500`, clamped 1–500). |
| `SHEETS_RETRY_BASE_MS` | no | Retry backoff base in ms (default `300`; lowered in tests). |
| `VITE_API_URL` | no | API base for the web app; unset uses the same-origin `/api` proxy. |

The Google Sheets export is optional — the app runs fine without `GOOGLE_*` set; the export endpoint returns a typed "not configured" error until those are provided.

---

## Deploy

The app deploys to **Vercel as a single project**: the web SPA is served as static assets and the Fastify API runs as a serverless function mounted at `/api` (same-origin, so the `sameSite=strict` session cookie works). Build wiring lives in `vercel.json`, `apps/api/src/vercelEntry.ts`, and `scripts/build-vercel.mjs` (which emits a Vercel Build Output API tree). Full operator steps: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md); Google Sheets setup: [`docs/SHEETS_EXPORT.md`](docs/SHEETS_EXPORT.md).

Outline:

1. Provision a production Postgres database; set `DATABASE_URL` in Vercel.
2. Run migrations **out of band** (`npm run db:deploy`) — migrations do not run during the Vercel build.
3. Set production env: a strong `SESSION_SECRET`, `COOKIE_SECURE=true`, `NODE_ENV=production`, `WEB_ORIGIN` = your deployed origin, and the `GOOGLE_*` values if you want export.
4. Connect the repo via Vercel's GitHub integration so pushes deploy.

> [!IMPORTANT]
> **Pre-public-exposure gate — rotate the landlord password.** The dev database was seeded with `LANDLORD_PASSWORD=changeme-dev`. Before exposing any deployment publicly, set a strong, unique `LANDLORD_PASSWORD`, re-seed (or update the stored hash), and confirm `COOKIE_SECURE=true` and a strong `SESSION_SECRET` are in place.
