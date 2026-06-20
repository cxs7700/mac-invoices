# Decision Log

Mirror of `PROJECT_PLAN.md` §12, plus decisions made during execution. Append, never delete.

## From the build plan (§12)

- **DEC-001 — PostgreSQL is source of truth; Sheets is export-only.** Avoids Sheets rate limits, lack of transactions, and data-loss risk.
- **DEC-002 — Currency stored as `Decimal(10,2)`.** Prevents floating-point money bugs.
- **DEC-003 — Session auth over JWT.** Simpler revocation, safer for a cookie-based web app. (Library TBD — see DEC-009.)
- **DEC-004 — Fastify over Express.** Schema-first + performance.

## Phase 0 (2026-06-20)

- **DEC-005 — Keep installed library versions over the §3 table.** Repo already runs React 19, React Router 7, TanStack Query 5, RHF 7, Zod 4, Tailwind v4, Prisma 7. The plan's §3 lists React 18 / RR v6; the installed versions are newer and working, so we keep them.
- **DEC-006 — Migrate to the npm-workspaces monorepo as Phase 0.** `apps/web` + `apps/api` + `packages/shared` per §4. The restructure is behavior- and schema-preserving; risky changes are sequenced into later phases.
- **DEC-007 — Adopt the §5 data model in Phase 2, not Phase 0.** Phase 0 makes zero schema changes. Phase 2 migrates to the §5 schema (cuid IDs, enums, auth tables) and remaps the existing 2025 seed data lossily.
- **DEC-008 — Cross-package imports use the workspace name `@mac-invoices/shared`** rather than a literal `@shared` path alias. The scoped package name resolves natively in tsc, Vite, tsx, and Vitest with zero extra alias config. (Deviation from §4's `@shared` wording, same intent.)
- **DEC-009 — Auth library deferred; Lucia is being sunset.** §3/§9 lock Lucia, but Lucia v3 is deprecated. Decide before Phase 3: hand-rolled sessions on Oslo primitives, or an alternative (e.g. better-auth). The §9 design intent (Prisma `Session` table, argon2, httpOnly/sameSite/secure cookies) holds regardless.
- **DEC-010 — Vitest 3 (not 2.x).** The repo pins `vite → rolldown-vite@7` via an override; Vitest 2.x cannot drive Vite 7 (`__vite_ssr_exportName__` error). Vitest 3 works.
- **DEC-011 — Single root `.env`.** One root `.env` is the env source of truth (per §13); the api loads it via `apps/api/src/lib/loadEnv.ts` so workspace-cwd scripts still find it. The generated Prisma client is gitignored (the prior `.gitignore` rule had the path inverted).
