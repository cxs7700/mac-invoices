# Conventions

Mirror of `PROJECT_PLAN.md` §11, plus patterns established during execution. Every new feature must conform.

## From the build plan (§11)

- **CONV-001 — Adding an API route:** create `apps/api/src/<name>.ts` exporting a Fastify plugin; validate the body with a shared Zod schema; scope all DB reads/writes to the session user; return the standard error shape; add a Vitest covering happy path + 1 failure + auth.
- **CONV-002 — Adding a model field:** edit `schema.prisma` → create migration → extend the matching Zod schema in `packages/shared` → update form + table columns → update seed.
- **CONV-003 — Adding a page:** create `apps/web/src/pages/<Name>.tsx`, register the route, fetch via a `hooks/use*.ts` TanStack Query hook (never call the api client directly in components).
- **CONV-004 — Money:** `Decimal(10,2)` in DB, `z.number().positive().multipleOf(0.01)` in Zod, format with `Intl.NumberFormat` in UI. No float math on currency.
- **CONV-005 — Errors:** throw typed errors caught by the central `errorHandler`; never leak stack traces or raw Prisma errors to the client.

## Phase 0 (2026-06-20)

- **CONV-006 — Monorepo layout:** frontend in `apps/web`, backend in `apps/api`, shared Zod/types in `packages/shared` (imported as `@mac-invoices/shared`). Run all scripts from the repo root; they delegate to workspaces.
- **CONV-007 — Definition of Done:** `npm run lint && npm run typecheck && npm run test` must pass before any change is considered done. CI enforces the same.
- **CONV-008 — Tests:** Vitest per workspace. Place tests in `<workspace>/test/`; api uses the `node` env, web uses `jsdom` + Testing Library. The Phase 0 smoke tests (`apps/api/test/smoke.test.ts`, `apps/web/test/smoke.test.tsx`) are the templates to copy.
- **CONV-009 — Intentionally-unused identifiers** are prefixed with `_` (ESLint is configured to ignore that prefix).
- **CONV-010 — Env:** add new env vars to `.env.example`; the api reads the single root `.env` via `loadEnv.ts`.
