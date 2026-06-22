---
title: "feat: Deploy Mac Invoices to Vercel (full-stack, single project)"
type: feat
date: 2026-06-22
status: ready
depth: deep
---

# feat: Deploy Mac Invoices to Vercel (single full-stack project)

## Summary

Ship the existing app to production on **one Vercel project**: the Vite SPA served as the static output, and the Fastify API mounted at `/api/*` on the **same origin** via a thin serverless function that wraps the existing `buildApp()`. Same-origin is non-negotiable because the session cookie is `httpOnly` + `sameSite=strict` (DEC-018) — a split web/API origin silently 401s every authenticated request. Deploys run through the **Vercel↔GitHub integration** (push to `main` → production; PR → preview). The API is **esbuild-bundled** (the source uses `.ts`-extension imports + path aliases that a stock Node runtime can't resolve), with native/Prisma deps externalized and the Prisma WASM client + generated dir force-included. Migrations run as a **separate serialized step against the direct DB URL**, never in the Vercel build; the seed is a one-off.

This plan is a decision artifact. It does **not** run `vercel` commands or deploy anything — execution does that, after the manual prerequisites (Vercel login, repo connect, env/secrets, DB choice).

---

## Problem Frame

Phases 0–4 produced a working full-stack app run locally (`apps/api` Fastify on `:3000`, `apps/web` Vite dev server). Production hosting was never set up — there is no `vercel.json`, no serverless entry, and `apiClient` points at `http://localhost:3000`. Getting this onto Vercel is non-trivial for three reasons the research confirmed:

1. **Auth topology constraint.** The `sameSite=strict` cookie forces the SPA and API under one origin. Vercel's new zero-config Fastify ("just call `listen()`") deploys the API *as the entire project* and cannot also serve the SPA — so we must use the explicit single-project layout (static output + a `/api` function), not server-capture.
2. **The API can't run as-is on a serverless runtime.** It imports modules with explicit `.ts` extensions (`./types.ts`, `../../prisma/generated/client.ts`), uses `@/*` / `@mac-invoices/shared` path aliases, and runs via `tsx`. Vercel's Node runtime resolves none of those — the API needs a bundle step.
3. **Native + WASM runtime deps.** `@node-rs/argon2` is a native `.node` addon (needs the Linux build) and Prisma 7's `prisma-client` generator ships a WASM query compiler + a custom `generated/` output dir — both are easy for a bundler/tracer to drop.

---

## Requirements

- **R1** — Production serves the SPA and the API from one Vercel project/origin (same-origin; cookie + auth work end-to-end over HTTPS).
- **R2** — The Fastify app runs as a Vercel serverless function wrapping the existing `buildApp()`, with routes resolving under `/api/*`.
- **R3** — The API is built into a runtime that resolves its `.ts`-extension imports and path aliases, with native (`@node-rs/argon2`) and Prisma deps present at runtime.
- **R4** — The web client talks to the API same-origin in production while local dev is unchanged.
- **R5** — Prisma is serverless-safe (singleton client, pooled `DATABASE_URL`, no per-request disconnect).
- **R6** — Production env/secrets are defined; migrations + seed run against the prod DB through a safe (non-build) path; the seed's fail-closed `LANDLORD_PASSWORD` guard is honored.
- **R7** — Deploys trigger from GitHub (push `main` → prod, PR → preview).
- **R8** — A documented end-to-end smoke checklist and a rollback path exist.

---

## Key Technical Decisions

- **KTD-1 — Single Vercel project, explicit `/api` handler (Pattern B).** Root Directory = repo root. The SPA static build is the output (`apps/web/dist`); a repo-root `api/index.ts` is the function. **Not** Vercel's zero-config Fastify capture — that's API-only and breaks same-origin. *(Research: deployment-expert "critical decision".)*
- **KTD-2 — Wrap `buildApp()` via ready-then-emit.** The handler awaits `app.ready()` **once at module scope** (so plugins/routes register on warm reuse) and emits each request to `app.server` (`app.server.emit('request', req, res)`). No `@fastify/aws-lambda` (that's the Lambda-adapter path, unneeded on Vercel's Node runtime). `apps/api/src/server.ts` stays as the local-only `listen()` entry. Fastify routes are registered as `/api/...` and see the **full original path**, so they match directly. The `vercel.json` rewrite destination `/api/index` is a reference to the function's path in the deployed filesystem (not a URL prefix applied to the captured path), so the incoming `/api/invoices` reaches Fastify unchanged — do **not** add a rewrite that rewrites the path itself or strips/re-adds `/api`.
- **KTD-3 — esbuild pre-bundle the API.** Bundle `api/index.ts` (pulling in `apps/api/src/**` + `@mac-invoices/shared`) to a single ESM `.js`, `platform=node`. **Externalize** `@prisma/*`, `pg`, `@node-rs/argon2`, `@node-rs/argon2-*` (native `.node` and the Prisma WASM runtime can't be inlined); resolve the `@/*` alias and `.ts` extensions at bundle time. Verify the emitted imports target `.js`, not a dangling `.ts`. *(Research: both agents — the `.ts`/alias/native-module constraints.)*
- **KTD-4 — Pin the runtime via `engines.node`.** Vercel ignores `.nvmrc`; it reads `engines.node` from the root `package.json`. Set `"engines": { "node": "24.x" }` (Node 24 is Vercel's 2026 default/GA — no downgrade needed). Major-selector only.
- **KTD-5 — Force-include Prisma's generated dir; let Vercel install native deps.** The deployed function is the **esbuild output `api/index.js`** (not the `.ts` source), so the `vercel.json` `functions` key is `api/index.js` everywhere. `functions["api/index.js"].includeFiles = "apps/api/prisma/generated/**"` so the WASM compiler + generated client ship in the function (NFT can trace the JS but miss the `.wasm`). `@node-rs/argon2-linux-x64-gnu` (glibc, not musl) installs automatically from a complete lockfile on Vercel's Linux builder — the risk is only a macOS-pruned lockfile. Prisma 7 is **Rust-free**: no `binaryTargets`/engine binary (ignore Prisma 5/6 serverless guides that set them). *(Research: framework-docs verified against the on-disk 7.x install.)*
- **KTD-6 — `prisma generate` in the build command, migrations out of it.** `generated/` is gitignored and `node_modules` is reinstalled fresh, so the build runs `db:generate`. Migrations (`prisma migrate deploy`) run as a **separate serialized step against the direct, non-pooled URL — named `DIRECT_URL`** — before the deploy, never in the build (concurrent builds race the migration lock with no clean rollback). **Ordering with GitHub auto-deploy:** because a push to `main` triggers the production deploy immediately, run the migration **before** merging/pushing the code that needs it (or keep the migration backward-compatible with the currently-deployed code), so the new function never boots against an un-migrated DB. The seed is a **one-off**, not a build/deploy step. (Prisma Postgres / `db.prisma.io` uses a single connection string and no separate `DIRECT_URL`; the pooled-vs-direct split applies to the managed-Postgres path — KTD-9.)
- **KTD-7 — Same-origin client base URL.** `apiClient` base becomes `import.meta.env.VITE_API_URL ?? ''` (empty → relative, same-origin). Local dev keeps `VITE_API_URL=http://localhost:3000` in `.env`; the Vercel build sets it empty/unset. CORS (`@fastify/cors`) becomes a no-op same-origin — leave it harmless rather than removing it.
- **KTD-8 — Prisma serverless singleton + pooled URL.** Keep the module-scope `PrismaClient` (already present) and add a `globalThis` singleton guard so Fluid Compute's warm reuse doesn't open new pools; keep the `pg` pool small; point `DATABASE_URL` at a **pooled** endpoint. Ensure the `connector.ts` `onClose` disconnect only fires on real shutdown (it does — `app.close()` isn't called per request), so no change needed there beyond verification.
- **KTD-9 — Production DB: recommend reuse-for-now, clean-DB as the prod path (decide at setup).** The current `db.prisma.io` is **Prisma Postgres — already serverless-pooled, migrated, and seeded**. *Recommended for the first deploy* (fastest; it's labeled "dev" but fine for a demo/staging URL). **Security caveat (must-do if reused):** that DB was seeded with the `changeme-dev` landlord password, so exposing it publicly = a **known-credential admin login**. Before the deploy is reachable, re-run the seed (which upserts the landlord `passwordHash`) with a **strong** `LANDLORD_PASSWORD` to rotate it. The clean path is a dedicated managed Postgres (Neon/Supabase/Vercel Postgres) with a pooled URL (`DATABASE_URL`) for the app + a direct URL (`DIRECT_URL`) for migrations, re-migrated and re-seeded with a strong `LANDLORD_PASSWORD`. Final pick is a setup-time decision (user deferred).

---

## High-Level Technical Design

```mermaid
flowchart LR
  subgraph Browser
    SPA[Vite SPA<br/>same origin]
  end
  subgraph Vercel Project (one origin)
    static[Static output<br/>apps/web/dist]
    fn["/api/index.js<br/>(esbuild bundle)"]
  end
  SPA -->|GET / asset| static
  SPA -->|/api/* (cookie, same-origin)| fn
  fn -->|buildApp() ready+emit| Fastify[Fastify routes /api/*]
  Fastify --> Prisma[PrismaClient singleton<br/>+ adapter-pg]
  Prisma -->|pooled DATABASE_URL| PG[(Postgres + pooler)]

  classDef ext fill:#eef,stroke:#88a
  class PG ext
```

Rewrite precedence (load-bearing): real static assets and the `api/` function are served by filesystem precedence first; then `/api/(.*) → /api/index`; then the SPA catch-all `/(.*) → /index.html` **last**, so it never swallows assets or the API.

---

## Implementation Units

### U1. Same-origin web client + tolerant env loading

**Goal:** The SPA calls the API same-origin in prod; local dev unchanged; env loaders don't fail when the root `.env` is absent (Vercel injects env directly).
**Requirements:** R4.
**Dependencies:** none.
**Files:**
- `apps/web/src/lib/apiClient.ts` (base URL → `VITE_API_URL ?? ''`)
- `apps/web/test/apiClient.test.ts` (assert relative base when unset)
- `apps/api/src/lib/loadEnv.ts`, `apps/api/prisma.config.ts` (confirm dotenv no-ops on a missing file — it does; add a clarifying comment only if needed)
- `.env.example` (note: in prod, `VITE_API_URL` is empty/same-origin; `COOKIE_SECURE=true`)

**Approach:** `dotenv`'s `config()` silently ignores a missing path, so `loadEnv`/`prisma.config` already tolerate Vercel (no file, vars already in `process.env`) — verify, don't rewrite. The only behavioral change is the apiClient default.
**Test scenarios:**
- `apiClient` issues a relative URL (`/api/...`) when `VITE_API_URL` is unset/empty; uses the absolute base when set (local dev).
- Existing apiClient tests still pass (credentials include, error shaping unchanged).
**Verification:** web tests green; a built SPA with no `VITE_API_URL` requests `/api/*` on its own origin.

### U2. Prisma serverless singleton guard

**Goal:** Warm Fluid-Compute instances reuse one `PrismaClient`/pool instead of opening new connections.
**Requirements:** R5.
**Dependencies:** none.
**Files:**
- `apps/api/src/lib/prisma.ts` (add a `globalThis` singleton guard around the existing module-scope client)
- `apps/api/test/` (only if a lightweight unit assertion is feasible; otherwise covered by the smoke checklist)

**Approach:** Reuse `globalThis.__prisma` when present; assign it outside production to survive module re-eval. Keep the single `PrismaPg` adapter. Do not add per-request connect/disconnect. Confirm `connector.ts`'s `onClose` only runs on shutdown.
**Test scenarios:**
- `Test expectation: none for the guard itself (env-dependent warm-reuse); covered by the deploy smoke checklist (U6). Existing api tests must remain green (the singleton must not change local/test behavior).`
**Verification:** api test suite unchanged and green; no per-request connection growth observed in the deployed function logs (smoke).

### U3. API serverless entry + bundle

**Goal:** A repo-root function that runs the Fastify app on Vercel, built so its `.ts`/alias/native deps resolve.
**Requirements:** R2, R3.
**Dependencies:** U1, U2.
**Files:**
- `api/index.ts` (new, repo root — the handler: `await app.ready()` once, `app.server.emit('request', req, res)`)
- `scripts/build-api.mjs` (new — a Node script calling esbuild's JS API: bundle `api/index.ts` → `api/index.js`, ESM, `platform=node`, externalize `@prisma/*`/`pg`/`@node-rs/argon2*`, alias `@/*`, resolve `.ts`)
- root `package.json` (a `"build:api": "node scripts/build-api.mjs"` script; wire into the Vercel build command — see U4)

**Approach:** The handler imports `buildApp` from the API source (bundled in). esbuild resolves the workspace + alias imports and rewrites `.ts` specifiers to `.js`; externals stay in `node_modules` for NFT to trace. Confirm the bundle output's imports reference real `.js`/package entries (no dangling `.ts`).
**Execution note:** Validate the bundle locally first — `node api/index.js` style smoke (or `vercel build`) to confirm it loads `buildApp`, the Prisma WASM client resolves, and argon2 loads; this is the highest-risk unit.
**Test scenarios:**
- Build produces `api/index.js` with no unresolved `.ts`/alias imports (bundle succeeds).
- A local invocation of the handler against a fixture request returns the health route 200 (smoke; integration via the deployed function in U6).
- `@node-rs/argon2` and the Prisma client both load in the bundled output (no "Failed to load native binding" / "did not initialize" errors).
**Verification:** `build:api` emits a self-contained handler; a local/`vercel build` smoke serves `/api/health` and a login round-trip.

### U4. Vercel project config (vercel.json + runtime pin)

**Goal:** One project builds the SPA + the API function, with correct rewrites, runtime, and file includes.
**Requirements:** R1, R7.
**Dependencies:** U3.
**Files:**
- `vercel.json` (new, repo root). Exact shape: `installCommand: "npm install"`, `buildCommand: "npm run db:generate && npm run build:api && npm run build"` (the existing root `build` is the web build, `-w @mac-invoices/web`), `outputDirectory: "apps/web/dist"`, `functions: { "api/index.js": { maxDuration, includeFiles: "apps/api/prisma/generated/**" } }`, `rewrites: [ { "/api/(.*)" → "/api/index" }, { "/(.*)" → "/index.html" } ]` (API rule first, SPA catch-all last)
- root `package.json` (`"engines": { "node": "24.x" }`)
- `.gitignore` (ignore `.vercel/` and the bundled `api/index.js` build artifact if generated)

**Approach:** Root Directory = repo root (not `apps/web`, or the root `api/` + workspace deps vanish). Do not use the legacy `builds` key (incompatible with `functions`). Rewrite order: API first, SPA catch-all last (filesystem precedence protects assets + the function).
**Test scenarios:**
- `Test expectation: config, not unit-testable. Verified by U6 smoke: assets load, /api/* hits the function, deep-linked SPA routes (e.g. /invoices/:id) serve index.html.`
**Verification:** a Vercel preview build succeeds; the smoke checklist (U6) passes against the preview URL.

### U5. Env matrix + DB + migration/seed workflow

**Goal:** Define every production env var and a safe migrate/seed path; pick the DB at setup.
**Requirements:** R6, R7.
**Dependencies:** U4.
**Files:**
- `docs/DEPLOYMENT.md` (new — the env-var matrix, DB-choice guidance per KTD-9, the migrate-then-deploy sequence, and the manual Vercel steps)
- `.env.example` (annotate prod-only expectations)

**Approach:** Env vars set in Vercel Project Settings, scoped per environment (Production/Preview/Development), secrets marked Sensitive; the GitHub integration injects them per env; env is baked at build (changing one needs a redeploy). Migrations: a serialized `npm run db:deploy` against the **direct** URL before the deploy (CI job or a documented manual step), not the build. Seed: a deliberate one-off (`npm run db:seed` with a strong `LANDLORD_PASSWORD`) against the chosen DB — note the seed throws if `LANDLORD_PASSWORD` is unset and refuses the `changeme-dev` default when `NODE_ENV=production`.
**Env matrix (production):** `DATABASE_URL` (pooled, app), `DIRECT_URL` (direct, for `db:deploy` — only the managed-Postgres path; not needed for Prisma Postgres), `LANDLORD_USER_ID`, `LANDLORD_EMAIL`, `LANDLORD_PASSWORD` (strong), `COOKIE_SECURE=true`, `NODE_ENV=production`, `VITE_API_URL` (empty/same-origin, build-time). `WEB_ORIGIN` optional (CORS is a no-op same-origin). **Set `COOKIE_SECURE=true` for the Preview environment too** — each PR preview is its own HTTPS `*.vercel.app` origin where the `sameSite=strict`+`Secure` cookie works per-origin (so login is exercised per preview).
**Test scenarios:**
- `Test expectation: none (docs + dashboard config). The fail-closed seed guard is already covered by apps/api tests; the deploy smoke (U6) proves the seeded landlord can log in.`
**Verification:** all required vars present in Vercel (Production); a one-off seed succeeds against the chosen DB; login works in the smoke.

### U6. Smoke verification + rollback

**Goal:** A repeatable post-deploy check and a documented rollback.
**Requirements:** R1, R8.
**Dependencies:** U5.
**Files:**
- `docs/DEPLOYMENT.md` (append the smoke checklist + rollback section)

**Approach:** Manual/scripted checks against the deployed URL (and each PR preview).
**Smoke checklist:**
- `GET /api/health` returns 200 over HTTPS.
- Login as the landlord → `Set-Cookie` carries `Secure`, `HttpOnly`, `SameSite=Strict`; `GET /api/auth/me` returns the user with the cookie.
- Unauthenticated `GET /api/invoices` → 401.
- CRUD + filter/sort (`status`/`from`/`to`/`vendor`/`sort`) + `GET /api/invoices/stats` reachable and ownership-scoped.
- SPA deep link (`/invoices/:id`) loads via the index.html rewrite; the FilterBar URL state survives refresh.
- No per-request connection growth / no "Failed to load native binding" / no "Prisma did not initialize" in function logs.
**Rollback:** Vercel keeps immutable deployments — roll back by promoting the previous production deployment (dashboard "Promote to Production" / `vercel rollback`). A bad migration is the only non-instant case: keep migrations backward-compatible for the in-flight deploy window, and have the direct-URL access to revert if needed.
**Verification:** every checklist item passes on the production URL.

---

## Dependencies & Prerequisites (manual — not automatable here)

These are **user/operator steps**; the units above prepare the repo for them:
1. A Vercel account + `vercel login` (browser auth), then connect the GitHub repo (or `vercel link`).
2. Choose/provision the production DB (KTD-9) and obtain its **pooled** + **direct** connection strings.
3. Set the U5 env matrix in Vercel (Production, and Preview if previews hit a DB).
4. Run the one-off migrate (`db:deploy`, direct URL) + seed (strong `LANDLORD_PASSWORD`) against the chosen DB.

---

## Scope Boundaries

**In scope:** the single-project Vercel config, the API serverless entry + bundle, the same-origin client change, the Prisma serverless guard, the env/DB/migration workflow docs, and the smoke + rollback checklist.

**Out of scope:**
- **Phase 5 — Google Sheets export** (`POST /invoices/export`, `sheetsSyncedAt`, service-account env). Not planned here.
- A custom domain, CDN tuning, observability/alerting beyond Vercel defaults, and CI gating of the migrate step (a documented manual/CI step is provided; a full GitHub Actions migrate-gate job is optional follow-up).
- Actually running any `vercel` command or deploying — execution-time, after prerequisites.

**Deferred to Follow-Up Work:**
- A GitHub Actions job that runs `db:deploy` (direct URL) as a required gate before production promotion (KTD-6 describes the pattern; automating it is optional).
- Migrating off the Prisma "dev" DB to a dedicated production Postgres if the first deploy reuses it (KTD-9).
- Per-owner `invoiceNumber` uniqueness migration (still gated on multi-user, unrelated to deploy).

---

## Risks & Mitigations

- **Bundling the API is the highest risk** (`.ts` specifiers + `@/*`/`@mac-invoices/shared` aliases + native/WASM deps). → esbuild with alias resolution + externals (KTD-3); validate the bundle locally / via `vercel build` before relying on a deploy (U3 execution note). Top failure strings to watch: "Failed to load native binding" (argon2 Linux binary), "Prisma did not initialize" / "Cannot find module …query_compiler…" (WASM/generated not included).
- **Wrong Vercel pattern** (zero-config Fastify capture) → API-only project, broken same-origin cookie. Mitigation: explicit `/api/index.ts` + repo-root Root Directory (KTD-1).
- **Connection exhaustion on serverless** → singleton client + small pool + **pooled** `DATABASE_URL`; no per-request disconnect (KTD-8).
- **Migrations in the build** → race/partial apply, no rollback. Mitigation: serialized out-of-build migrate against the direct URL (KTD-6).
- **macOS-pruned lockfile** drops the Linux argon2 optional dep → runtime crash. Mitigation: let Vercel's Linux build install from a complete lockfile; `includeFiles`/force-install as backup.
- **Env baked at build** → a changed secret needs a redeploy; document it (U5).
- **Reusing the "dev" Prisma DB** for production data → acceptable for a demo URL, flagged; **rotate the landlord password** (known `changeme-dev`) before exposure; clean-DB path documented (KTD-9, deferred follow-up).
- **Login rate-limit degrades on serverless** → `@fastify/rate-limit` uses an in-process store, so on Vercel's per-instance functions the 10/15-min login limit is per-warm-instance, not fleet-wide (weaker brute-force protection). Known Phase 3 residual; a shared-store (Redis/Upstash) rate-limit is the real fix — note it, deferred. The `argon2` verify cost still bounds throughput.
- **`.nvmrc` (v24.12) vs `engines.node` (24.x)** → consistent (same major); Vercel pins from `engines.node`, local/CI from `.nvmrc`. No action beyond adding `engines.node`.

---

## Verification (overall)

- A Vercel **preview** build (from a PR) passes the U6 smoke checklist end-to-end before any production promotion.
- Production: login over HTTPS sets a `Secure`+`HttpOnly`+`SameSite=Strict` cookie; full CRUD + filter/sort + stats work; SPA deep links resolve; function logs are clean.
- `npm run lint && npm run typecheck && npm run test` stay green for the repo changes (U1–U2 code; U3–U6 are config/docs).

---

## Sources & Research

Load-bearing external research (mid-2026), grounded against the installed tree:
- **Vercel:** single-project vs zero-config-Fastify capture (same-origin forces the explicit handler); Node 24 default + `engines.node` pin (`.nvmrc` ignored); `vercel.json` monorepo (`functions`/`includeFiles`/rewrite order); Fluid Compute warm reuse; env baked-at-build; migrations-out-of-build. (vercel.com/docs: frameworks/backend/fastify, functions/runtimes/node-js, project-configuration/vercel-json, fluid-compute, deployments/git.)
- **Prisma 7 / native deps:** `prisma-client` generator is **Rust-free** (WASM compiler + mandatory `@prisma/adapter-pg`), no `binaryTargets`/engine binary; force-include the custom `generated/` (WASM can be traced out); `@node-rs/argon2-linux-x64-gnu` (glibc) resolution; externalize native/WASM in any bundler; singleton client + pooled URL + `connection_limit=1`. (prisma.io/docs: no-rust-engine, deploy-to-vercel, connection-pool; github.com/napi-rs/node-rs.)
