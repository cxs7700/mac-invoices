---
title: "feat: Phase 5 — Google Sheets Export"
type: feat
date: 2026-06-22
status: ready
depth: standard
---

# feat: Phase 5 — Google Sheets Export

## Summary

Add a manual-trigger, ownership-scoped `POST /api/invoices/export` that appends the landlord's
**un-synced** invoices to a Google Sheet via a **service account** (`googleapis`), stamps
`sheetsSyncedAt` on the rows it writes, and survives Google's 429 quota limits with retry/backoff +
chunked writes — plus a single-flight **"Export to Sheets"** button (hook + loading/success/error
states) on the web. Postgres stays the source of truth; Sheets is a one-way downstream export
(DEC-001), delivered **at-least-once** (append-only; rows keyed by `id`). The Sheets client lives in a
**thin module the handler imports and tests `vi.mock`** so Google is never called in tests, and the
module sanitizes provider errors so credentials never reach logs/clients. The endpoint is
rate-limited. No migration — `sheetsSyncedAt` already exists in the §5 schema.

**DoD (PROJECT_PLAN §10 Phase 5):** clicking export writes the user's invoices to the sheet; tests
mock the Sheets client (no live Google calls); `npm run lint && npm run typecheck && npm run test`
green (CONV-007).

---

## Problem Frame

Phases 0–4 made invoices fully manageable in the app. §8/§2 call for Google Sheets as a downstream
**export destination** so the landlord can pull invoice data into a spreadsheet they already work in.
The §5 schema already carries `sheetsSyncedAt DateTime?` (added in the Phase 2 migration) precisely so
an export can mark what's been sent. This phase wires the service-account integration, the export
endpoint, and a one-click UI — the first time the app reaches an external third-party API, which
shapes the design around mockability, quota handling, and partial failure.

---

## Requirements

Traces to PROJECT_PLAN §8, §7 (the `/invoices/export` row), §10 Phase 5.

- **R1** — `POST /api/invoices/export` (body `{ spreadsheetId? }` → success `{ exported: number }`),
  behind `requireAuth`, ownership-scoped, and **rate-limited** per the login pattern.
- **R2** — Authenticates to Google via a **service account** (`GOOGLE_SERVICE_ACCOUNT_KEY` JSON env,
  `spreadsheets` scope); target sheet defaults to `GOOGLE_SHEET_ID`, written to a **pinned tab**.
- **R3** — Exports only **un-synced** invoices (`sheetsSyncedAt IS NULL`) for the user, appends the §8
  column set, and stamps `sheetsSyncedAt` on the rows written. Delivery is **at-least-once** (a lost
  ack can re-send; rows are identifiable by the `id` first column).
- **R4** — Handles 429/quota with bounded retry + exponential backoff; writes in chunks of ≤500;
  per-chunk stamping makes a retry resume; a mid-export failure returns a non-2xx carrying the
  durable `exported` count.
- **R5** — The Sheets module is mockable (tests `vi.mock` it) so there are **no live Google calls in
  tests** (DoD); Google error objects are never forwarded raw (no credential/PII leak to logs/clients).
- **R6** — Web: an "Export to Sheets" action (hook + button) with loading / success (`exported`) /
  error states; the button is disabled while pending (single-flight).
- **R7** — `npm run lint && typecheck && test` green; the export feature works end-to-end through the UI.

---

## Key Technical Decisions

- **KTD-1 — A thin `sheets` module, mocked in tests (no DI ceremony).** A module wraps `googleapis`:
  `GoogleAuth` (credentials from the parsed `GOOGLE_SERVICE_ACCOUNT_KEY`, scope
  `https://www.googleapis.com/auth/spreadsheets`), exposing a narrow `appendRows(spreadsheetId, rows)`.
  The handler imports it directly; tests **`vi.mock` the module** so Google is never called (R5, DoD).
  This matches the repo (no `vi.mock` precedent yet, and `buildApp()` has no injection point — adding a
  Fastify decoration/options bag would be more plumbing than the mockable module). The googleapis client
  is created lazily/once (module scope), not per request.
- **KTD-1b — Sanitize Google errors.** The module catches googleapis errors and re-throws a typed
  `AppError` carrying only a stable code + safe message — never the raw error/`cause` (which can embed
  the `private_key`/`client_email` or echo the sheet id). This keeps credentials out of the Fastify log
  and out of client responses (security review).
- **KTD-2 — Export only un-synced rows; at-least-once append log.** Query
  `where: { userId, sheetsSyncedAt: null }` (DEC-019), `values.append` the rows, then
  `updateMany({ where: { id: { in: appended }, userId } })` to set `sheetsSyncedAt = now`. Repeat exports
  send only un-synced invoices — so duplicates are bounded to the **lost-ack window** (Google appends +
  returns, but the function dies before the stamp): those rows are in the sheet yet still un-synced, so
  the next export re-appends them. This is honest **at-least-once** delivery, not exactly-once; the `id`
  first column makes any duplicate row identifiable/strippable. (A true idempotency-key dedupe is deferred
  — see Follow-Up.) Edited-after-export invoices are not re-sent (append-only; re-export-on-edit deferred).
- **KTD-3 — Chunk + per-chunk stamp; simple success, error on partial.** Always write in chunks of
  **≤500 rows per `append` call** regardless of total (§8). After a chunk's append succeeds, stamp that
  chunk's ids (so a retry resumes — the safest re: duplicates). On full success return
  `{ exported: number }`. If a chunk fails after retries, **stop** and throw `AppError(502, …, { exported })`
  — the already-stamped rows are durable and the caller sees how many made it. (No `partial` success
  field — a partial outcome is an error, which keeps the success contract single-shaped.)
- **KTD-4 — 429/quota retry with backoff.** Each `append` retries on 429 (and transient 5xx) with bounded
  exponential backoff + jitter (a few attempts), inside the module. Non-retryable errors (auth/permission/
  404 sheet) fail fast via the sanitized `AppError` (KTD-1b), mapped to a fixed client code.
- **KTD-5 — Env-default target + pinned tab; no live header check.** `spreadsheetId =
  body.spreadsheetId ?? process.env.GOOGLE_SHEET_ID`; if neither is set → 400. Every call uses a
  **fully-qualified range on a pinned tab** (`${GOOGLE_SHEET_TAB ?? 'Invoices'}!A1`) so a multi-tab
  workbook can't mis-target. The header row is a **one-time operator setup step** (documented in
  DEPLOYMENT.md), not a per-export `values.get`+conditional-write — dropping `ensureHeader` removes a read
  round-trip, a read-permission concern, and a tab-mismatch footgun.
- **KTD-5b — `spreadsheetId` override is a documented risk; env-only by default.** The UI sends **no**
  `spreadsheetId` (it uses the env default), so a normal session can't redirect the export. The body
  override stays in the §7 contract but is flagged: a session passing an arbitrary id (any sheet shared
  with the service account) could exfiltrate invoice data — so if it's ever exposed it must be
  allowlisted. MVP: accept the override but don't surface it in the UI.
- **KTD-6 — Cell value mapping.** Columns (§8 order): `id, invoiceNumber, vendorName, amount, status,
  invoiceDate, dueDate, category, description`. At the handler layer `invoice.amount` is a Prisma
  **Decimal object** (not a string — CONV-013 is about JSON-response serialization, a later layer), so
  write the number via **`invoice.amount.toNumber()`**; dates as `YYYY-MM-DD`; `dueDate` null → empty
  cell. `valueInputOption: 'USER_ENTERED'` so numbers/dates land as typed cells.
- **KTD-7 — Fail clearly: unset vs malformed key, both 503.** Wrap `JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY)`
  in try/catch. Unset → `503` "Sheets export is not configured"; **set-but-malformed** (the common case —
  env values mangle the private key's `\n`) → `503` "…credentials are malformed". Distinct, actionable
  messages, never an uncaught throw. Client created lazily, so a bad key never crashes boot.
- **KTD-8 — googleapis is a new dependency** in `apps/api`. Server-to-server only (service account) — no
  OAuth/user-consent flow (out of scope).
- **KTD-9 — Rate-limit the export route.** Reuse `@fastify/rate-limit` (as the login route does) with a
  modest per-session cap (e.g. 5 / 15 min) so an authenticated session can't burn the shared Google write
  quota or hammer the DB scan (security review).
- **KTD-10 — Single-flight against concurrent exports.** Two concurrent exports (double-click) both read
  the same un-synced set before either stamps → duplicates. Mitigations: the button is **disabled while
  pending** (client-side, U4), and the rate-limit (KTD-9) caps bursts. A server-side Postgres advisory
  lock (`pg_advisory_xact_lock`) around the read→append→stamp is the robust guard — noted as a small
  hardening (Follow-Up) if double-submits prove real; acknowledged here rather than silently assumed away.

---

## High-Level Technical Design

```mermaid
sequenceDiagram
  participant UI as Export button (web)
  participant API as POST /api/invoices/export
  participant DB as Postgres (Prisma)
  participant S as sheets module (googleapis)
  participant G as Google Sheets

  UI->>API: {} (env-default sheet; cookie auth)
  API->>DB: find invoices WHERE userId, sheetsSyncedAt IS NULL
  loop each chunk (<=500 rows)
    API->>S: appendRows(spreadsheetId, chunk) [pinned tab]
    S->>G: values.append (retry/backoff on 429)
    G-->>S: ok
    API->>DB: updateMany set sheetsSyncedAt for chunk ids
  end
  API-->>UI: { exported: n }   (or 502 { exported: x } on mid-export failure)
```

A chunk that fails after retries breaks the loop and returns a 502 carrying the durable `exported`
count; stamped rows survive, so a retry resumes on the still-un-synced remainder. The lost-ack window
(append succeeds at Google but the function dies before the stamp) is the at-least-once gap — bounded,
and identifiable by the `id` column.

---

## Implementation Units

### U1. Sheets integration module + dependency + env

**Goal:** A thin, mockable `sheets` module wrapping `googleapis` service-account auth with append +
429-retry + sanitized errors. No live header check (header is operator setup — KTD-5).
**Requirements:** R2, R4, R5, KTD-1/1b/4/5/7.
**Dependencies:** none.
**Files:**
- `apps/api/package.json` (add `googleapis`)
- `apps/api/src/integrations/sheets.ts` (new — lazy `GoogleAuth`; `appendRows(spreadsheetId, rows)` to a
  pinned tab range; 429/5xx retry+backoff; try/catch around `JSON.parse(key)`; typed `AppError`s for
  unset vs malformed key; catches googleapis errors → sanitized `AppError` (no raw error/cause))
- `apps/api/test/integrations/sheets.test.ts` (new — `vi.mock('googleapis')`, no network)
- `.env.example` (confirm `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_SHEET_ID`; add `GOOGLE_SHEET_TAB` optional)

**Approach:** The handler imports the module directly; tests `vi.mock` it (KTD-1). The retry wrapper +
error sanitization live here (one place to test). Reads env lazily so importing never throws. Range is
`${GOOGLE_SHEET_TAB ?? 'Invoices'}!A1`, fully qualified, on every call.
**Patterns to follow:** the §8 sketch (GoogleAuth credentials + scope); the `apps/api/src/lib/` +
`apps/api/src/db/connector.ts` module-scope-singleton pattern; `AppError` from `middleware/errorHandler`.
**Test scenarios (`googleapis` mocked — no network):**
- `appendRows` calls `values.append` with the right `spreadsheetId`, the **pinned-tab** range, the mapped
  values, and `valueInputOption: 'USER_ENTERED'`.
- A 429 then success → retries and resolves (assert attempt count, backoff invoked).
- Persistent 429 → rejects after the bounded attempts (no infinite loop).
- `GOOGLE_SERVICE_ACCOUNT_KEY` unset → typed "not configured" `AppError` (no throw at import).
- `GOOGLE_SERVICE_ACCOUNT_KEY` set to malformed JSON → typed "credentials malformed" `AppError`, not an
  uncaught `SyntaxError`.
- A googleapis error (e.g. 403) → re-thrown as a sanitized `AppError` whose message/cause does **not**
  contain the credentials or raw Google payload.
**Verification:** the module appends to the pinned tab, retries 429, distinguishes unset/malformed key,
and never leaks credentials — all without touching the network in tests.

### U2. Shared export request schema

**Goal:** A validated request contract for the endpoint.
**Requirements:** R1.
**Dependencies:** none.
**Files:**
- `packages/shared/src/schemas/invoice.ts` (add `ExportInvoicesSchema` = `{ spreadsheetId?: string }`,
  + inferred type; the success response type `{ exported: number }` — a partial outcome is a non-2xx
  error, not a success field)
- `packages/shared/test/invoice-query.test.ts` or a new test (schema accepts empty body + an optional id)

**Approach:** Mirror the existing shared-schema pattern; `spreadsheetId` optional trimmed string.
**Test scenarios:**
- Empty `{}` parses (spreadsheetId optional); a provided non-empty id parses; a whitespace-only id rejects.
**Verification:** schema exported from `@mac-invoices/shared`; unit test green.

### U3. Backend export endpoint

**Goal:** The ownership-scoped, rate-limited export handler + route: un-synced append + per-chunk stamp,
single success shape, 502-on-partial.
**Requirements:** R1, R3, R4, KTD-2/3/5/6/7/9.
**Dependencies:** U1, U2.
**Files:**
- `apps/api/src/invoices/handlers.ts` (add `exportInvoices`)
- `apps/api/src/invoices/routes.ts` (register `POST /api/invoices/export` with `requireAuth` + a
  `config.rateLimit` like the login route — KTD-9)
- `apps/api/test/invoices.export.test.ts` (new — CONV-012; the `sheets` module is `vi.mock`ed)

**Approach:** `parseBody(ExportInvoicesSchema, request.body)`; resolve `spreadsheetId` (body ?? env, else
400); `findMany({ where: { userId, sheetsSyncedAt: null } })`; map rows to the §8 cell order via
`invoice.amount.toNumber()` (KTD-6); chunk ≤500; per chunk: `appendRows` then `updateMany` stamp the
chunk's ids; accumulate `exported`. On a chunk failure after retries, throw `AppError(502, …, { exported })`.
Return `{ exported }` on success. The handler **imports the `sheets` module**; the test `vi.mock`s it
(KTD-1 — no Fastify decoration). Unset/malformed key surfaces as the module's 503 (KTD-7).
**Execution note:** start with a failing integration test for the request→append→stamp contract.
**Test scenarios (CONV-012; `sheets` module mocked):**
- 401 without auth.
- Happy: seed 3 un-synced invoices → export → mock `appendRows` called with 3 mapped rows; all 3 get
  `sheetsSyncedAt`; response `{ exported: 3 }`.
- Idempotency: a second export immediately → 0 un-synced → `appendRows` not called → `{ exported: 0 }`.
- Ownership: a second user's un-synced invoices are neither read nor stamped (reuse `createSecondUser`).
- Chunking: >500 rows → multiple `appendRows` calls; all stamped.
- Partial failure: mock the 2nd chunk to reject after retries → first chunk's rows stamped, the response
  is `502` carrying `{ exported: <firstChunk> }`, and the 2nd chunk's rows remain un-synced (a retry
  resends only those).
- Target: no `GOOGLE_SHEET_ID` and no body id → 400; a body `spreadsheetId` overrides env.
- Unconfigured / malformed key: → 503 with the respective clear code.
- Cell mapping: `amount` is a number, null `dueDate` → empty cell (assert the values passed to the mock).
**Verification:** export writes the right rows, stamps only what's written, is owner-scoped + idempotent +
rate-limited, and degrades (502 partial / 400 / 503) correctly — all against the mock.

### U4. Web export hook + button

**Goal:** A one-click "Export to Sheets" with proper states.
**Requirements:** R6.
**Dependencies:** U3.
**Files:**
- `apps/web/src/hooks/useExportInvoices.ts` (new — `useMutation` POST `/api/invoices/export`, no body)
- `apps/web/src/pages/InvoiceList.tsx` (add the button near "New invoice")
- `apps/web/test/useExportInvoices.test.tsx` and/or `InvoiceList.test.tsx` (extend)

**Approach:** The button calls the mutation with **no body** (env-default sheet — KTD-5b); it is
**disabled while `isPending`** (single-flight — KTD-10). Show a spinner while pending, a success note
(`Exported ${result.exported}`), and a readable error via `ApiError` for the 503 (unconfigured/malformed),
502 (partial — message includes how many exported), and 429 (rate-limited) cases. CONV-003 (fetch via
hook only). No cache invalidation needed — `sheetsSyncedAt` isn't surfaced in the list/stats today (drop
the `['invoice-stats']` invalidation; a future "synced" indicator can add it).
**Test scenarios:**
- Clicking POSTs to `/api/invoices/export`; the button is disabled while pending; success shows the
  `exported` count.
- The button doesn't re-fire while a request is in flight (disabled-on-pending).
- An `ApiError` (503 unconfigured, or 502 partial) surfaces a readable message including the count where present.
**Verification:** the button exports, is single-flight (disabled while pending), and reflects
loading / success (`exported`) / error (503 / 502 / 429).

### U5. Docs + conventions

**Goal:** Record the integration decisions and tick the phase.
**Requirements:** R7.
**Dependencies:** U1–U4.
**Files:**
- `docs/CONVENTIONS.md` (CONV-016 — external-integration pattern: wrap third-party clients in a thin
  module mocked via `vi.mock`; retry/backoff on 429; sanitize provider errors before logging/returning)
- `docs/DECISIONS.md` (DEC-021 — service-account export, un-synced-only append, **at-least-once** delivery,
  env-default sheet, pinned tab, rate-limited)
- `docs/DEPLOYMENT.md` (a concrete operator runbook: create the GCP service account → download the key →
  **share the target sheet as Editor with the SA `client_email`** → write the header row once → set
  `GOOGLE_SERVICE_ACCOUNT_KEY` (Sensitive), `GOOGLE_SHEET_ID`, optional `GOOGLE_SHEET_TAB` in Vercel)
- `PROJECT_PLAN.md` (§10 Phase 5 checkboxes)

**Approach:** Short, accurate entries mirroring the existing CONV/DEC style.
**Test scenarios:** `Test expectation: none — docs only.`
**Verification:** conventions/decisions recorded; §10 ticked; deploy env documented.

---

## Scope Boundaries

**In scope:** the service-account Sheets module (mockable, sanitized errors), the rate-limited
`POST /api/invoices/export` endpoint (un-synced append + per-chunk stamp + 429 handling, env-default
sheet, pinned tab), the single-flight web export button/hook, and the docs.

**Out of scope:**
- PDF / Excel export and a report builder.
- Sheets **import / read-back** (one-way export only — DEC-001).
- Scheduled / automatic sync (manual trigger only).
- OAuth / end-user Google consent (service account only); multi-user sheet sharing.

**Deferred to Follow-Up Work:**
- **Exactly-once / idempotency-key dedupe** — write a per-row key so a lost-ack duplicate (KTD-2) is
  detected and stripped, upgrading at-least-once to exactly-once.
- **Server-side single-flight** — a Postgres advisory lock around read→append→stamp (KTD-10) if
  double-submits prove real beyond the button-disable + rate-limit.
- **Re-export on edit** — an invoice edited after export isn't re-sent (append-only); a future "force
  re-export" could clear `sheetsSyncedAt` or update the sheet row.
- **`spreadsheetId` allowlist** if the body override is ever surfaced in the UI (KTD-5b).
- **Async/background export** for very large volumes; **Vercel `maxDuration`** hardening (see Risks).
- Per-owner `invoiceNumber` uniqueness migration (still gated on multi-user; unrelated).

---

## System-Wide Impact

- **New dependency:** `googleapis` in `apps/api`.
- **New env:** `GOOGLE_SERVICE_ACCOUNT_KEY` (Sensitive), `GOOGLE_SHEET_ID`, optional `GOOGLE_SHEET_TAB`
  (add to the Vercel env matrix in `docs/DEPLOYMENT.md`). Operator must **share the target sheet as
  Editor with the service-account `client_email`** and write the header row once.
- **API contract:** new rate-limited `POST /api/invoices/export` (the §7 row); no change to existing routes.
- **Data:** writes `sheetsSyncedAt` (existing column); no migration.

---

## Risks & Mitigations

- **Duplicate rows (at-least-once, not exactly-once)** — the un-synced filter + per-chunk stamp prevents
  duplicates on a *clean* chunk failure, but NOT in the **lost-ack window**: if Google appends + returns
  but the function dies (network drop or `maxDuration`) before `updateMany` stamps, those rows are in the
  sheet yet still un-synced, so the next export re-appends them. Honest mitigation: accept at-least-once
  for the MVP; the `id` first column makes any duplicate identifiable/strippable; idempotency-key dedupe
  is the deferred upgrade (Follow-Up). **Intra-chunk timeout is this same window** — not the clean-boundary
  case.
- **Concurrent exports** — a double-click / browser retry runs two read→append→stamp passes that both see
  the same un-synced set → duplicates. Mitigated by the disabled-while-pending button (U4) + the route
  rate-limit (KTD-9); the advisory-lock guard is the robust deferred option (KTD-10).
- **Serverless `maxDuration`** — chunked + per-chunk-stamp keeps progress durable; a retry resumes the
  remainder (modulo the lost-ack window above); single-landlord volumes are small. Async deferred.
- **Quota / 429** — bounded retry + backoff + jitter (KTD-4); chunked writes keep calls small; the route
  rate-limit (KTD-9) caps how fast a session can consume the shared write quota.
- **Credential / PII leakage** — googleapis errors can embed the `private_key`/`client_email` or the sheet
  id; the module re-throws a **sanitized `AppError`** (KTD-1b) so nothing sensitive reaches the Fastify
  log or the client. `GOOGLE_SERVICE_ACCOUNT_KEY` is set Sensitive in Vercel, never committed (`*.env`).
- **Misconfig** — unset vs malformed key both → a distinct, clear 503 (KTD-7); sheet-not-shared / wrong-id
  → a fixed client code (not the raw Google message). Covered by tests + the operator runbook.
- **`spreadsheetId` exfil** — the override could target any SA-shared sheet; the UI never sends it
  (env-only), and if exposed it must be allowlisted (KTD-5b).

---

## Verification (Phase DoD)

- Integration tests (the `sheets` module mocked) cover: auth 401, happy append+stamp, idempotent
  re-export, ownership isolation, chunking, 502 partial-failure (durable count), target resolution,
  unconfigured + malformed key (503), error sanitization, and cell mapping.
- Clicking "Export to Sheets" writes the user's un-synced invoices to the sheet and reports the count;
  the button is single-flight and rate-limited.
- `npm run lint && npm run typecheck && npm run test` green across `packages/shared`, `apps/api`, `apps/web`.
