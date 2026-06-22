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
- **DEC-017 — Adopt the "Rent Ops" design as the visual language (Phase 3).** From the imported Claude Design (project `e6ecdcd1-5b4d-4cec-8b7a-802f77f97980`, "Invoice System — Hi-Fi"). Tailwind/shadcn tokens re-mapped to: accent `#1d5fb0`, Public Sans, neutral surfaces, status colors (paid `#1f8a5b`, overdue `#b8442a`). Reference: `docs/design/rent-ops-reference.md`. Auth (login email/password), shell, list, detail, edit recreated in our system this phase; landing/dashboards/reports/OCR deferred.

## Phase 3 (2026-06-22)

- **DEC-018 — Hand-rolled sessions on `@oslojs`** (not Lucia — sunset, DEC-009; not better-auth). argon2id (`@node-rs/argon2`) password hashing; a random opaque token in an httpOnly+`sameSite=strict` cookie (`COOKIE_SECURE` env gates `secure`); the token's SHA-256 stored as `Session.id`; fixed 30-day lifetime (no sliding renewal); session rotation on login; `requireAuth` preHandler injects `request.user`. Email/password login only for the seeded landlord (no signup/OAuth). Login rate-limited (`@fastify/rate-limit`). Constant-time login (dummy verify on unknown email). No migration (the `Session` model already fit).
- **DEC-019 — Ownership via `updateMany`/`deleteMany` + count.** Prisma `update`/`delete` need a unique `where`; `{id, userId}` isn't unique, so writes use `updateMany`/`deleteMany({id,userId})` with `count===0 → 404`, and reads use `findFirst`. Non-owned rows read 404 (no existence leak). The `LANDLORD_USER_ID` server-default is gone — `userId = request.user.id`.

- **DEC-016 — Per-invoice images modeled now, feature deferred.** Added `InvoiceImage` (url + `ImageType` enum + caption) and `CONTRACTOR` to `Role` in the §5 migration, per a mid-phase requirement (invoices carry cash/parts/check photos viewable by contractors + landlords). The upload pipeline (presigned S3/R2 — §7 Phase 7 backlog), create-form image fields, and viewing UI are deferred to a dedicated later phase.

## Phase 4 (2026-06-22)

- **DEC-020 — Phase 4 list UX decisions.** (a) **Filter/sort/page state lives in the URL** (`useSearchParams`), not local `useState` — shareable, refresh-safe, back-button-correct; serves the ≤2-interactions DoD and closes the deep-link gap. (b) **Status counts are all-time**, independent of the active filter, via a dedicated `GET /api/invoices/stats` (`groupBy`) — deriving them client-side would require fetching every page. (c) **Strict API, sanitizing client**: the API 400s on malformed query params; the web layer sanitizes URL params to defaults first (`apps/web/src/lib/listParams.ts`). (d) **Vendor filter** = case-insensitive `contains` (debounced), not a vendor picker (deferred). The per-owner `invoiceNumber` uniqueness migration stays deferred (gated on multi-user).

## Phase 5 (2026-06-22)

- **DEC-021 — Google Sheets export decisions.** (a) **Service account** (`googleapis`, scope `spreadsheets`) — server-to-server, no OAuth/user consent; share the sheet as Editor with the SA `client_email`. (b) **Un-synced-only append**: export rows where `sheetsSyncedAt IS NULL`, then stamp them, so repeat exports don't duplicate. (c) **At-least-once, not exactly-once**: the lost-ack window (Google appends but the function dies before the stamp) can re-send on the next export; rows are identifiable by the `id` first column; an idempotency-key dedupe is deferred. (d) **Chunk ≤500 + per-chunk stamp** (resumable); full success → `{ exported }`, a mid-export failure → `502` carrying the durable count. (e) **Env-default target** (`GOOGLE_SHEET_ID`) on a **pinned tab** (`GOOGLE_SHEET_TAB`); the body `spreadsheetId` override is accepted but not surfaced in the UI (exfil risk — allowlist if ever exposed). (f) **Rate-limited** route + **single-flight** button. Operator setup: `docs/SHEETS_EXPORT.md`.
