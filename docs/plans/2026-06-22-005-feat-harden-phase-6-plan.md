---
type: feat
title: "feat: Phase 6 in-repo hardening (helmet, body limit, log redaction, README)"
date: 2026-06-22
depth: standard
phase: 6 (Harden & Deploy — code half only)
---

# feat: Phase 6 In-Repo Hardening

## Summary

The code half of **Phase 6 — Harden & Deploy** (PROJECT_PLAN §10): add HTTP security headers, an explicit request body-size cap, request-log secret redaction, and a real README with an env reference + deploy steps. This is the in-repo, fully-testable work; the **actual deploy** (provisioning Postgres, setting Vercel secrets, connecting the GitHub integration, rotating the landlord password, verifying SSL end-to-end) is explicitly **out of scope** and the user drives it later.

All three runtime changes land in the `buildApp()` factory or the central error handler, so they flow automatically to both local dev and the deployed Vercel `/api` function (which wraps `buildApp()` via `api/index.ts`, merged in PR #6). DoD: `npm run lint && npm run typecheck && npm run test` green.

---

## Problem Frame

Phase 6 readies the app for public exposure. Four gaps remain on the code side:

- **No security headers.** The Fastify app sends no HSTS, frame-deny, nosniff, or CSP. A public deployment should set these defensively.
- **No explicit body limit.** Fastify defaults to a 1 MB body cap. Invoice JSON payloads are tiny; an explicit, small, documented cap shrinks the abuse surface and makes the limit a reviewed decision rather than a framework default.
- **Logs can leak secrets.** The app runs `Fastify({ logger: true })` with no redaction. Pino's default request serializer omits headers, but any future logging of `req.headers` / `res` — and the existing `request.log.error(error)` in the error handler — could surface the session `cookie`, `set-cookie`, or `authorization`. Redaction makes this safe by construction.
- **README is the stock Vite template.** It says nothing about this project, its env vars, how to run it, or how to deploy. The Phase 6 DoD requires "fresh clone runs with documented steps only."

## Scope Boundaries

**In scope:** `@fastify/helmet` registration; explicit `bodyLimit` + a clean 413 error code; pino redaction config; a full README rewrite (env reference + run/deploy steps).

**Out of scope (deploy half — user-driven, later):**
- Provisioning the production Postgres database
- Setting any secrets on Vercel (`GOOGLE_SERVICE_ACCOUNT_KEY`, `SESSION_SECRET`, etc.)
- Connecting the Vercel GitHub integration / triggering a deploy
- Rotating the `changeme-dev` landlord password (a **pre-public-exposure gate** — documented in the README, executed at deploy time)
- SSL / end-to-end verification against a live URL

**Deferred to follow-up work:** none for this slice.

---

## Key Technical Decisions

- **KTD-1: Register helmet inside `buildApp()`, globally, before routes.** One registration covers every route and flows to the Vercel function for free. Helmet's defaults give nosniff (`X-Content-Type-Options`), frame-deny (`X-Frame-Options: SAMEORIGIN` → set to `DENY`), and HSTS. HSTS is emitted regardless of transport but is a no-op over plain http (browsers ignore it without TLS), so enabling it unconditionally is safe for localhost.
- **KTD-2: Use a relaxed/api-appropriate CSP, not helmet's restrictive HTML default.** The Fastify function serves **JSON under `/api` only** — the SPA is served as Vercel static assets, not by Fastify, so a strict script/style CSP on API responses buys nothing and risks surprising future error pages. Set a minimal CSP (`default-src 'none'`, `frame-ancestors 'none'`) appropriate for a pure-JSON API, OR disable helmet's `contentSecurityPolicy` for API responses and document why. Recommendation: minimal `default-src 'none'` CSP — JSON responses reference no resources, so nothing breaks, and it is maximally restrictive. Verify the health and error responses still return cleanly.
- **KTD-3: `bodyLimit` = 64 KB, set on the Fastify factory.** Invoice payloads are a handful of short fields; 64 KB is ~100× headroom over the largest realistic invoice JSON while capping abuse. Set via `Fastify({ bodyLimit: 65536 })`.
- **KTD-4: Map Fastify's body-too-large error to a clean `PAYLOAD_TOO_LARGE` code.** Fastify throws `FST_ERR_CTP_BODY_TOO_LARGE` with `statusCode: 413`. The current error handler's generic 4xx branch already renders it in the §7 shape — but with the raw framework code as `error.code`. Add an explicit mapping so clients see a stable `PAYLOAD_TOO_LARGE` code (consistent with the other curated codes like `CONFLICT`, `NOT_FOUND`).
- **KTD-5: Redact via pino's `redact` option on the logger config.** Replace `logger: true` with `logger: { redact: [...] }` covering `req.headers.cookie`, `req.headers.authorization`, and `res.headers["set-cookie"]` (and their case variants as pino paths require). This is config, not control flow — it neutralizes the leak at the serializer layer regardless of what future code logs.
- **KTD-6: README is a full rewrite, not an append.** The current file is the stock Vite template and describes nothing real. Replace it wholesale with project overview, prerequisites, setup, the env reference table, run/test commands, and deploy steps that point at `docs/SHEETS_EXPORT.md` and the Vercel topology from PR #6.

---

## Implementation Units

### U1. Security headers via @fastify/helmet

**Goal:** Every response carries defensive security headers.

**Requirements:** Phase 6 "Security headers" DoD item.

**Dependencies:** none.

**Files:**
- `apps/api/package.json` (add `@fastify/helmet` dependency — pick the version compatible with Fastify 5, mirroring how `@fastify/cors`/`@fastify/rate-limit` are pinned)
- `apps/api/src/app.ts` (register helmet in `buildApp()` before routes)
- `apps/api/test/security-headers.test.ts` (new)

**Approach:** `app.register(helmet, { ... })` immediately after the error handlers / alongside the other plugins, before route registration. Configure per KTD-1/KTD-2: keep nosniff + frame-deny + HSTS defaults; set a minimal `contentSecurityPolicy` (`default-src 'none'`, `frame-ancestors 'none'`) suited to a JSON API. Confirm it composes with the existing `@fastify/cors` registration (helmet sets response headers; cors handles origin/credentials — no conflict) and does not interfere with the `sameSite=strict` cookie.

**Patterns to follow:** the existing `app.register(cors, {...})` call in `apps/api/src/app.ts`; version-pinning style in `apps/api/package.json`.

**Test scenarios (`apps/api/test/security-headers.test.ts`, via `buildApp()` + `app.inject()`):**
- A GET to the health route returns `x-content-type-options: nosniff`.
- The same response carries `x-frame-options` (DENY) and a `content-security-policy` header.
- `strict-transport-security` is present (HSTS emitted regardless of transport).
- A normal JSON route (e.g. health) still returns its expected 200 body — headers did not break the response.

**Verification:** security-headers test green; existing suites still pass (helmet did not disturb CORS, cookies, or error responses).

---

### U2. Explicit request body-size limit + clean 413

**Goal:** Oversized request bodies are rejected at 64 KB with a stable §7 error.

**Requirements:** Phase 6 "input size limits" DoD item.

**Dependencies:** none (independent of U1).

**Files:**
- `apps/api/src/app.ts` (add `bodyLimit` to the `Fastify({...})` options)
- `apps/api/src/middleware/errorHandler.ts` (map `FST_ERR_CTP_BODY_TOO_LARGE` → `PAYLOAD_TOO_LARGE`)
- `apps/api/test/error-handler.test.ts` (extend) and/or a focused body-limit test

**Approach:** Set `Fastify({ logger: ..., bodyLimit: 65536 })` (65536 = 64 KB; define as a named const with a comment). In `errorHandler`, before the generic 4xx branch, add: if the error's `code === 'FST_ERR_CTP_BODY_TOO_LARGE'` (or `statusCode === 413`), render `body('PAYLOAD_TOO_LARGE', 'Request body too large', ...)` at 413. Keep the generic 4xx fallthrough intact for everything else.

**Patterns to follow:** the existing curated-code mappings in `errorHandler` (P2002→CONFLICT, P2025→NOT_FOUND); `AppError`/`body()` shape.

**Test scenarios:**
- POST `/api/invoices` (or any body route) with a payload exceeding 64 KB returns `413`.
- The 413 body matches the §7 shape `{ error: { code: 'PAYLOAD_TOO_LARGE', message } }` — assert `code` specifically (proves the mapping, not just the framework default).
- A normal small invoice create still succeeds (limit does not reject legitimate payloads) — covered by existing create tests; add an explicit just-under-limit case only if cheap.

**Verification:** body-limit test green; the §7 `code` is `PAYLOAD_TOO_LARGE`, not `FST_ERR_CTP_BODY_TOO_LARGE`.

---

### U3. Request-log secret redaction

**Goal:** Session cookies and auth headers never appear in logs.

**Requirements:** Phase 6 "request logging" hardening.

**Dependencies:** none (independent of U1/U2).

**Files:**
- `apps/api/src/app.ts` (replace `logger: true` with a redaction-configured logger object)
- `apps/api/test/` — light assertion optional; otherwise a documented manual-check note in the unit

**Approach:** Configure pino `redact` with paths covering `req.headers.cookie`, `req.headers.authorization`, and `res.headers["set-cookie"]` (use the pino bracket-path syntax for hyphenated/case-variant header keys as needed). This is the HTTP request/response logger — distinct from the Phase 5 googleapis-error sanitization, which already protects the `request.log.error(error)` path in the error handler. Keep `logger` on (do not disable logging); only add redaction.

**Patterns to follow:** Phase 5's secret-handling posture (no credential reaches logs); existing `Fastify({ logger: true })` call.

**Test scenarios:**
- `Test expectation: light` — redaction is logger config. If a cheap assertion is feasible (e.g. capture the logger stream and assert a request carrying a `cookie` header logs `[Redacted]` rather than the value), include it. Otherwise record a one-line manual-verification note in the unit and rely on config review. Do not contort the test harness for this.

**Verification:** logger config includes the three redact paths; if the stream-capture assertion was added, it is green.

---

### U4. README rewrite — overview, env reference, run/deploy steps

**Goal:** A fresh clone can be set up, run, tested, and deployed from the README alone.

**Requirements:** Phase 6 "README: setup, env reference, run/deploy steps"; DoD "fresh clone runs with documented steps only."

**Dependencies:** none (docs-only; can land independently).

**Files:**
- `README.md` (full rewrite — replace the stock Vite template)

**Approach:** Replace the template wholesale. Sections:
- **Overview** — what Mac Invoices is (full-stack invoice manager; npm-workspaces monorepo: `apps/web`, `apps/api`, `packages/shared`), pointing at `CLAUDE.md` / `PROJECT_PLAN.md` for depth.
- **Prerequisites** — Node version (per `engines`), Docker for local Postgres.
- **Setup** — copy `.env.example` → root `.env`, `docker compose up -d`, `npm install`, `npm run db:push` / `npm run db:seed`.
- **Run / test** — `npm run dev` (web), `npm run dev:api`, and the DoD gate `npm run lint && npm run typecheck && npm run test`.
- **Environment reference** — a table covering **every** var in `.env.example`: `DATABASE_URL`, `NODE_ENV`, `SESSION_SECRET`, `WEB_ORIGIN`, `LANDLORD_USER_ID`, `LANDLORD_EMAIL`, `LANDLORD_PASSWORD`, `COOKIE_SECURE`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB`, `EXPORT_RATE_LIMIT_MAX`, `EXPORT_CHUNK_SIZE`, `SHEETS_RETRY_BASE_MS`, `VITE_API_URL` — each with purpose + whether required in prod.
- **Deploy** — the Vercel topology from PR #6 (single project; SPA static + Fastify `/api` serverless function; same-origin so the `sameSite=strict` cookie works); link `docs/SHEETS_EXPORT.md` for the Sheets service-account setup; call out that migrations run **outside** the build.
- **Pre-public-exposure gate** — a prominent note: **rotate the landlord password** (dev DB was seeded with `changeme-dev`); set `COOKIE_SECURE=true` and a strong `SESSION_SECRET` in prod.

**Patterns to follow:** `.env.example` (authoritative var list + inline comments); `docs/SHEETS_EXPORT.md` (operator-doc tone).

**Test scenarios:** `Test expectation: none — documentation only.`

**Verification:** README describes this project (no stock Vite text remains); every `.env.example` var appears in the env table; deploy section references the Vercel topology + `docs/SHEETS_EXPORT.md` + the password-rotation gate.

---

## Risks & Dependencies

- **CSP breaking responses (low).** A too-strict CSP on API JSON is essentially inert (JSON references no resources), but verify the health + error paths return cleanly under the chosen policy (U1 tests cover this). Mitigation: minimal `default-src 'none'` rather than helmet's HTML-oriented default.
- **helmet ↔ Fastify 5 version compatibility.** Pin the `@fastify/helmet` major that targets Fastify 5 (same family as the other `@fastify/*` v10/v11 plugins). Resolve the exact version at implementation time from the registry.
- **Redaction assertion brittleness (low).** Don't over-engineer a log-capture test; config review + an optional light assertion is acceptable per U3.
- **Body-limit false positives (very low).** 64 KB is far above any real invoice payload; the just-under-limit create case guards against an over-tight cap.

## System-Wide Impact

`buildApp()` is the single construction path used by **tests** (`app.inject()`), **local dev/`server.ts`**, and the **Vercel `/api` function** (`api/index.ts`). U1–U3 therefore harden all three surfaces from one change. No new env vars are introduced; no migration. The deploy half of Phase 6 consumes this work but is sequenced separately and driven by the user.
