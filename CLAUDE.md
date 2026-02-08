# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mac Invoices is a full-stack invoice management app with a React frontend (Vite) and a Fastify backend API backed by PostgreSQL via Prisma ORM.

## Common Commands

- `npm run dev` — Start Vite dev server (frontend)
- `npm run start` — Start Fastify backend server (port 3000)
- `npm run build` — Type-check and build frontend (`tsc -b && vite build`)
- `npm run lint` — Run ESLint
- `npm run generate` — Generate Prisma client (`npx prisma generate`)
- `npm run script` — Run database seed/migration script (`tsx ./src/api/db/script.ts`)

No test runner is currently configured.

## Architecture

### Backend (`src/api/`)

Fastify server with plugin-based architecture:

- **`server.ts`** — Entry point. Registers the Prisma DB connector plugin and invoice routes. Listens on port 3000.
- **`db/connector.ts`** — Fastify plugin that decorates the instance with a Prisma client. Handles disconnect on server close.
- **`invoices/`** — Invoice CRUD module with separate `routes.ts`, `handlers.ts`, and `types.ts` files.

**Note:** There are two route implementations — `myRoutes.ts`/`myHandlers.ts` (currently imported by `server.ts`) and `routes.ts`/`handlers.ts` (newer, more complete). The server currently uses the `myRoutes` variant.

API endpoints (all prefixed `/api/invoices`):
- `POST /` — Create invoice
- `GET /` — List invoices (supports `status`, `creatorId`, `limit`, `offset` query params)
- `GET /:id` — Get invoice by ID
- `PATCH /:id` — Update invoice
- `DELETE /:id` — Delete invoice

Prisma error codes handled: P2002 (unique constraint violation → 409), P2025 (not found → 404).

### Frontend (`src/`)

- **`App.tsx`** — React form for creating invoices using React Hook Form
- **`components/ui/`** — shadcn/ui components (new-york style, Tailwind CSS v4)
- **`main.tsx`** — React app entry point

Key frontend libraries: React 19, React Hook Form, TanStack Query, React Router, Zod.

### Database (`src/prisma/`)

- **`schema.prisma`** — Defines `User` and `Invoice` models. Invoice belongs to User via `creatorId`.
- **`seed.ts`** — Database seeding script.
- **`generated/`** — Prisma client output (gitignored). Regenerate with `npm run generate`.
- **`migrations/`** — Prisma migration history.

Prisma config is in `prisma.config.ts` at the project root. The schema path is `src/prisma/schema.prisma`.

### Path Aliases

TypeScript path alias `@/*` maps to `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).
