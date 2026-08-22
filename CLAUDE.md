# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mac Invoices is a full-stack invoice management app with a React frontend (Vite) and a Fastify backend API backed by PostgreSQL via Prisma ORM. It is an **npm-workspaces monorepo**: `apps/web` (frontend), `apps/api` (backend), and `packages/shared` (Zod schemas + types shared by both).

`PROJECT_PLAN.md` is the build plan; `docs/plans/` holds the per-phase execution plans. The work is sequenced in phases (see PROJECT_PLAN §10) — Phase 0 (this foundation) is complete.

## Common Commands

Run from the repo root (scripts delegate to the right workspace):

- `npm run dev` — Start the Vite dev server (web). `npm run dev:api` starts the API.
- `npm run start` — Start the Fastify backend (port 3000)
- `npm run build` — Type-check and build the web app
- `npm run lint` — ESLint across all workspaces
- `npm run typecheck` — `tsc --noEmit` across shared, api, web
- `npm run test` — Vitest across workspaces
- `npm run format` / `npm run format:check` — Prettier
- `npm run db:generate` / `npm run db:push` / `npm run db:migrate` / `npm run db:reset` / `npm run db:seed` — Prisma (target `apps/api`)
- Local Postgres: `docker compose up -d` (see `.env.example` for env)

**Definition of Done for any change:** `npm run lint && npm run typecheck && npm run test` all green (also enforced in CI: `.github/workflows/ci.yml`).

## Architecture

### Backend (`apps/api/`)

Fastify server with plugin-based architecture:

- **`src/app.ts`** — `buildApp()` factory: constructs the Fastify instance (security headers via `@fastify/helmet`, an explicit `BODY_LIMIT_BYTES` body cap, redacting logger, error/not-found handlers, cookie/CORS/DB plugins, routes) **without listening**, so tests use `app.inject()`. Also used by the Vercel `/api` function.
- **`src/server.ts`** — Entry point: calls `buildApp()` and `.listen()` on port 3000.
- **`src/db/connector.ts`** — Fastify plugin that decorates the instance with a Prisma client. Handles disconnect on server close.
- **`src/lib/prisma.ts`** — Prisma client (pg adapter). Imports `./loadEnv.ts` to load the single root `.env` regardless of cwd.
- **`src/invoices/`** — Invoice CRUD module.
- **`src/lib/log.ts`** — Operational logging. `loggerOptions` in `app.ts` owns the transport (pino) and secret redaction; this module owns *what a log line may contain*. `logEvent(log, level, fields)` emits only the names in `LOG_FIELD_KEYS` — an **allow-list**, enforced both by the `LogFields` type (no index signature, so a stray `{ email }` is a compile error) and at runtime (so a spread or cast cannot smuggle one past). Only opaque cuids, counts, durations, status codes and stable error codes are loggable; names, emails, phones, addresses, amounts and error *messages* are not. `reason` must be a code (`bad_password`), never prose. `LOG_LEVEL` sets verbosity (default `info`, `silent` under test). Events use stable dot-names: `auth.login`, `auth.signup`, `auth.reset`, `submission.link.denied`, `cron.auth`, `email.send`, `digest.flush`, `sheets.flush`, `request.client_error`, `request.server_error`.

  **When adding a log call, use `logEvent` — never `request.log.info({...})` directly**, which bypasses the allow-list. `test/logging.pii.test.ts` drives real requests carrying real personal data and asserts none of it reaches any log line; `test/log.test.ts` and `test/log-redaction.test.ts` cover the helper and the serializers.

Invoice routes live in `routes.ts` (plugin) → `handlers.ts` (validated handlers) → `types.ts`. The old `myRoutes`/`myTypes` variant was removed when the implementations were consolidated in Phase 1 (OQ-1 resolved).

API endpoints (all prefixed `/api/invoices`):
- `POST /` — Create invoice
- `GET /` — List invoices (supports `status`, `creatorId`, `limit`, `offset` query params)
- `GET /:id` — Get invoice by ID
- `PATCH /:id` — Update invoice
- `DELETE /:id` — Delete invoice

Prisma error codes handled: P2002 (unique constraint violation → 409), P2025 (not found → 404).

### Frontend (`apps/web/`)

- **`src/App.tsx`** — React form for creating invoices using React Hook Form
- **`src/components/ui/`** — shadcn/ui components (new-york style, Tailwind CSS v4)
- **`src/main.tsx`** — React app entry point

Key frontend libraries: React 19, React Router 7, React Hook Form, TanStack Query, Zod.

### Shared (`packages/shared/`)

Zod schemas + TS types imported by both apps as `@mac-invoices/shared`. Real invoice schemas (PROJECT_PLAN §6) land in Phase 2.

### Database (`apps/api/prisma/`)

- **`schema.prisma`** — The §5 model (Phase 2): `User` (cuid, `passwordHash`, `role`) + `Session` (auth tables, unused until Phase 3), `Invoice` (cuid, `invoiceNumber`, `vendorName`, `amount Decimal(10,2)`, `category`/`status` enums, `userId`), and `InvoiceImage` (per-invoice photos: `url`, `ImageType` enum, `caption` — upload/view UI deferred to a later phase). `Role` includes `VENDOR`.
- **`Vendor`** (table `vendors`) — a landlord's contractors/payees, formerly named `Contractor` (renamed in full — see `docs/DECISIONS.md` DEC-032). Fields: `name`, nullable `phone`/`email` (the "at least one" rule is enforced in Zod, not a SQL CHECK), plus the no-login submission-link fields (`tokenLookupId`/`tokenVersion`/`revokedAt`/`lastUsedAt`). The link **secret is derived, never stored** — `HMAC(VENDOR_LINK_KEY, tokenLookupId:tokenVersion)`, see `src/vendors/token.ts` and DEC-034 — which is what lets the landlord copy a vendor's link at any time. `VENDOR_LINK_KEY` is a required env var; bumping `tokenVersion` rotates the link, `revokedAt` turns it off without replacing it. Phone is normalized to `123-456-7890` at the schema boundary (`formatPhone` in `@mac-invoices/shared`), so one shape reaches the list, the PDF and the Sheets mirror. A raw-expression UNIQUE index on `(landlordId, lower(name))` (not modelled in `schema.prisma` — Prisma can't express `lower()`; see the comment on the `Vendor` model) enforces one name per landlord case-insensitively. `Invoice` carries **two** separate FKs to `Vendor`: `vendorId` (attribution — who the invoice is from, drives the PDF Sender) and `submittedByVendorId` (provenance, and the authorization scope for a vendor's no-login submission link). They are deliberately not collapsed.
- **`seed.ts`** + `seed-data.csv` — Seeds the single landlord (`LANDLORD_USER_ID`) and the 2025 invoices. Until auth, the API sets `invoice.userId` to the landlord server-side on create.
- **`generated/`** — Prisma client output (gitignored). Regenerate with `npm run db:generate`.
- **`migrations/`** — Prisma migration history.

Prisma config is `apps/api/prisma.config.ts`; schema path is `prisma/schema.prisma` (relative to the api workspace).

### Path Aliases & Env

- `@/*` maps to each app's own `./src/*` (configured per-workspace in `tsconfig.json`; web also in `vite.config.ts`).
- Cross-package imports use the workspace name `@mac-invoices/shared`.
- A single root `.env` is the source of truth for env (loaded by the api via `apps/api/src/lib/loadEnv.ts`). See `.env.example`.
