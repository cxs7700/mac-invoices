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

## Phase 2 (2026-06-21)

- **DEC-012 — Interim creator association: seeded landlord + server-default `userId`.** Until auth (Phase 3), the create handler sets `userId` server-side to the seeded landlord (`LANDLORD_USER_ID`) and never reads userId from the body — already honoring §7. Phase 3 swaps the constant for `req.user.id`.
- **DEC-013 — §5 migration by dev reset + reseed, not data-preserving** (DEC-007). The Int→cuid id change + field renames made a data-preserving migration not worth it; the Prisma-hosted dev DB was reset (with explicit user consent) and reseeded from CSV. `invoiceNumber` is user-supplied, not generated.
- **DEC-014 — Phase 2 wires validation for CREATE only.** Both Create/Update shared schemas are defined; only POST is wired. PATCH/DELETE validation + their UI are Phase 3. The two cheap Phase-1 deferrals (list clamp, P2003→400) landed here.
- **DEC-015 — Zod validates in the handler.** `parseBody(schema, data)` maps `ZodError`→`AppError('VALIDATION_ERROR', 400, details)` through the central handler (not Fastify JSON-schema). `@hookform/resolvers@5` on the web side (v3 rethrows Zod 4 errors).
- **DEC-016 — Per-invoice images modeled now, feature deferred.** Added `InvoiceImage` (url + `ImageType` enum + caption) and `CONTRACTOR` to `Role` in the §5 migration, per a mid-phase requirement (invoices carry cash/parts/check photos viewable by contractors + landlords). The upload pipeline (presigned S3/R2 — §7 Phase 7 backlog), create-form image fields, and viewing UI are deferred to a dedicated later phase.
