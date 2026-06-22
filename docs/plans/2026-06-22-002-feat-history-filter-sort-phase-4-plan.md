---
title: "feat: Phase 4 — History, Status & Metadata UX (filter/sort/counts)"
type: feat
date: 2026-06-22
status: ready
origin: PROJECT_PLAN.md §10 Phase 4
depth: standard
---

# feat: Phase 4 — History, Status & Metadata UX

## Summary

Turn the invoice list into a real history/search surface. The backend gains date-range, vendor, and multi-field sort on `GET /api/invoices` (on top of the existing status filter + offset pagination, still ownership-scoped, all validated by one shared Zod query schema), plus a read-only status-counts endpoint. The frontend gains a URL-synced `FilterBar` (status + date range + debounced vendor search + sort), a surfaced due-date column, refined empty/loading/error states, and a small read-only status-counts strip that doubles as a one-click status filter. Status-transition actions (mark paid / dispute-reject / delete) already exist from Phase 3 — this phase only keeps them reachable, it does not rebuild them.

**DoD (PROJECT_PLAN §10 Phase 4):** the landlord can find any invoice by status / date / vendor in ≤2 interactions; integration tests cover the new filter/sort/count query paths; `npm run lint && npm run typecheck && npm run test` all green (CONV-007).

---

## Problem Frame

Phase 3 shipped CRUD behind auth with a list that filters by status only and paginates. As the invoice history grows, the landlord needs to *find* invoices — by when they were issued, by who billed them, and in a useful order — and to see an at-a-glance breakdown of where money stands by status. The §7 API contract already reserves `status, from, to, vendor, sort, page` for `GET /invoices`; Phase 4 implements the rest of that contract and the read-only metadata UX around it.

This is an extend-don't-rebuild phase: `useInvoices`, `InvoiceTable`, `StatusBadge`, `isOverdue`, the pagination controls, and the ownership-scoped `listInvoices` handler all exist and are reused.

---

## Requirements

Traces to PROJECT_PLAN §10 Phase 4 and §7.

- **R1** — `GET /api/invoices` accepts date-range (`from`/`to` on `invoiceDate`), `vendor` (contains), and `sort` (field + direction) in addition to the existing `status` + pagination, all ownership-scoped to `request.user.id`.
- **R2** — All list query params are validated by one shared Zod schema; `sort` is restricted to a whitelist (no arbitrary `orderBy`).
- **R3** — A read-only status-counts endpoint returns totals by status for the session user (all-time, independent of active filters).
- **R4** — The list page exposes a `FilterBar`: status, date range, debounced vendor search, and sort controls; filter/sort/page state lives in the URL (shareable, back-button, refresh-safe).
- **R5** — The list surfaces due-date + derived overdue (reusing `StatusBadge`/`isOverdue`) and has clean empty / loading / error states for the filtered case.
- **R6** — A read-only status-counts strip renders totals by status and acts as a one-click status-filter shortcut.
- **R7** — Integration tests cover each new filter/sort/count query path; the DoD scripts pass.

---

## Key Technical Decisions

- **KTD-1 — One shared list-query schema; sort is whitelisted.** `ListInvoicesQuerySchema` in `packages/shared` validates `status, from, to, vendor, sort, order, limit, offset`. `sort ∈ {invoiceDate, amount, dueDate, status}` and `order ∈ {asc, desc}` are enums — Prisma's `orderBy` is built only from those, never from a raw string, closing arbitrary-orderBy injection. Default = `invoiceDate desc` (preserves Phase 3 behavior). (CONV-011)
- **KTD-2 — Date range filters `invoiceDate`, inclusive, UTC.** `from`/`to` are optional, independent, date-only (`YYYY-MM-DD`), coerced to dates. `from` → `gte` start-of-day; `to` → `lte` end-of-day (inclusive whole day). Comparison stays in UTC to match the create-path coercion and the UTC `formatDate` (Phase 3) — avoids off-by-one day shifts.
- **KTD-3 — Vendor filter = case-insensitive `contains`, debounced client-side.** `where.vendorName = { contains: vendor, mode: 'insensitive' }`. The text input is debounced (~300ms) before it updates the URL/query so typing doesn't fire a request per keystroke.
- **KTD-4 — Filter/sort/page state lives in the URL.** `InvoiceList` uses React Router `useSearchParams` as the single source of truth; `useInvoices` reads the resolved values. Page is **1-based in the URL** (`page=1` default, human-friendly) and converted to `offset = (page-1) * PAGE_SIZE` for the API. Changing any filter resets `page` to 1. This serves the ≤2-interactions DoD and closes the deep-link gap noted in the Phase 3 review. **Confirmed scoping decision (2026-06-22):** URL-synced state was chosen over local `useState` deliberately (vs. the simpler local-state alternative) — it is not scope drift; the small extra cost (`listParams.ts` sanitize layer + page↔offset conversion) buys shareable/refresh-safe/back-button-correct filtering.
- **KTD-5 — Counts via `groupBy`, all-time, separate endpoint.** `GET /api/invoices/stats` runs `prisma.invoice.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } })`, zero-fills every `InvoiceStatus` to a stable shape `{ counts: { PENDING: n, … }, total }`. **All-time** — independent of the active filter (per the locked decision), so the strip is a stable overview + filter shortcut. A separate endpoint (vs. deriving counts client-side) is warranted: the list only returns the current page, so client derivation would require fetching every page just to count — one `groupBy` is strictly cheaper and scales.
- **KTD-6 — API stays `limit`/`offset`; only the URL uses `page`.** No breaking change to the Phase 3 list contract — the new params are purely additive, and existing `limit`/`offset` callers (the integration tests) keep working. The `page`↔`offset` conversion is a client concern.
- **KTD-7 — Strict API, sanitizing client.** The API validates and 400s on genuinely malformed params (consistent with the Phase 3 status-filter behavior). The page **sanitizes** URL params against the known option sets (valid statuses, sort fields, date shape) before building the query, so a hand-edited/garbage URL falls back to defaults and renders rather than 400ing. Strictness lives at the boundary; resilience lives at the URL reader.

---

## Implementation Units

### U1. Shared list-query schema + sort whitelist

**Goal:** A single validated contract for every `GET /api/invoices` query param, with a typed sort whitelist.
**Requirements:** R1, R2.
**Dependencies:** none.
**Files:**
- `packages/shared/src/schemas/invoice.ts` (add `ListInvoicesQuerySchema`, `InvoiceSortField`, `SortOrder`, and inferred types)
- `packages/shared/src/index.ts` (export — already re-exports the schemas module; confirm coverage)
- `packages/shared/test/invoice-query.test.ts` (new)

**Approach:** Add `InvoiceSortField = z.enum(['invoiceDate','amount','dueDate','status'])`, `SortOrder = z.enum(['asc','desc'])`, and `ListInvoicesQuerySchema = z.object({ status: InvoiceStatus.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), vendor: z.string().trim().min(1).optional(), sort: InvoiceSortField.default('invoiceDate'), order: SortOrder.default('desc'), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100_000).default(0) })`. The `offset.max(100_000)` ceiling (security review) caps deep-pagination table scans — a cheap client-triggered cost lever otherwise unbounded once `limit` is capped at 100. Query values arrive as strings, so use `z.coerce` for dates/numbers (mirrors `CreateInvoiceSchema`'s `z.coerce.date()`). Export inferred `ListInvoicesQueryInput`.
**Patterns to follow:** the existing enums + `UpdateInvoiceSchema` in the same file; `z.coerce.date()` usage from `CreateInvoiceSchema`.
**Test scenarios:**
- Happy: a full valid query (all params) parses; defaults apply when `sort`/`order`/`limit`/`offset` omitted (`invoiceDate`/`desc`/`50`/`0`).
- Edge: empty object → all-optional fields absent, defaults present.
- Edge: `limit` above 100 / below 1, negative `offset`, and `offset` above 100,000 → rejected (so the handler can rely on bounds) — assert `result.success === false` and inspect `result.error`.
- Error: `sort: 'vendorName'` (not whitelisted) and `order: 'sideways'` → `safeParse` fails.
- Error: `from: 'not-a-date'` → fails.
**Verification:** schema exported from `@mac-invoices/shared`; unit tests green; `npm run typecheck` clean.

### U2. Backend — filter + sort in `listInvoices`

**Goal:** Apply date-range, vendor, and whitelisted sort to the ownership-scoped list, keeping status + pagination.
**Requirements:** R1, R2.
**Dependencies:** U1.
**Files:**
- `apps/api/src/invoices/handlers.ts` (`listInvoices`)
- `apps/api/src/invoices/types.ts` (extend `ListInvoicesQuery` with `from,to,vendor,sort,order`)
- `apps/api/src/invoices/routes.ts` (no change beyond the existing generic; confirm)
- `apps/api/test/invoices.list.test.ts` (extend)

**Approach:** Replace the ad-hoc `status`/`clampInt` parsing with `parseBody(ListInvoicesQuerySchema, request.query)`. `parseBody` is already generic — it takes `data: unknown` and runs `schema.safeParse(data)` (see `apps/api/src/lib/validate.ts`), so it works on `request.query` directly; on failure it throws the §7 400 (same path the current invalid-status check uses). Build `where` from `{ userId }` + optional `status`, `invoiceDate` (`gte from` / `lte` end-of-`to`), and `vendorName: { contains, mode: 'insensitive' }`. Build `orderBy` from the validated enums only — as a two-key array `[{ [sort]: order }, { invoiceDate: 'desc' }]` so the nullable `dueDate` sort has a stable tiebreaker (NULLs otherwise float unpredictably). Keep the `Promise.all([findMany, count])` shape and the `{ data, pagination }` response.
**Patterns to follow:** the existing `listInvoices` (`where`/`Promise.all`/`clampInt`), `InvoiceStatus.safeParse` 400 path, DEC-019 ownership scoping.
**Execution note:** extend the existing list integration test first (it already logs in + cleans by prefix) — assert the new filters before wiring them.
**Test scenarios (CONV-012, against the dev DB):**
- Happy: seed 3 invoices with distinct `invoiceDate`/`vendorName`/`amount`; `from`/`to` window returns only the in-range rows.
- Happy: `vendor=acme` (mixed case in data) returns the case-insensitive matches only.
- Happy: `sort=amount&order=asc` returns ascending by amount; `sort=invoiceDate&order=desc` is the default ordering.
- Edge: combined `status=PENDING&from=…&vendor=…` narrows on all three simultaneously.
- Edge: a filter matching nothing → `{ data: [], pagination: { total: 0 } }`.
- Error: `sort=vendorName` or `from=garbage` → 400 (no rows leaked, no 500).
- Ownership: a second user's in-range/matching invoice never appears (reuse `createSecondUser`).
**Verification:** all list filter/sort permutations return correct, owner-scoped rows; invalid params 400; existing list tests still pass.

### U3. Backend — status-counts endpoint

**Goal:** A read-only, ownership-scoped totals-by-status endpoint for the dashboard strip.
**Requirements:** R3.
**Dependencies:** none (independent of U1/U2).
**Files:**
- `apps/api/src/invoices/handlers.ts` (add `invoiceStats`)
- `apps/api/src/invoices/routes.ts` (register `GET /api/invoices/stats` with `requireAuth`)
- `apps/api/test/invoices.stats.test.ts` (new)

**Approach:** `groupBy({ by: ['status'], where: { userId: request.user.id }, _count: { _all: true } })`, then fold into a zero-filled record over `InvoiceStatus.options` plus a `total`. Returns `{ counts: Record<InvoiceStatus, number>, total: number }`. **Auth (security review):** register the route inside the existing `invoiceRoutes` plugin reusing the same `const auth = { preHandler: requireAuth }` constant the other routes use — per-route auth is the established Phase 3 pattern, and the `401 without auth` test below is the verification gate against an accidental omission (a route registered without `auth` compiles cleanly). The literal `/stats` path and the parameterized `/:id` path are distinct; Fastify disambiguates regardless of registration order.
**Patterns to follow:** ownership scoping (DEC-019), the route-registration shape in `routes.ts`, `InvoiceStatus.options` for the stable key set.
**Test scenarios (CONV-012):**
- 401 without auth.
- Happy: seed N invoices across ≥2 statuses; response counts match and sum to `total`; every status key is present (zero-filled).
- Ownership: a second user's invoices do not contribute to the landlord's counts.
**Verification:** endpoint returns a complete, owner-scoped status map; 401 unauth; tests green.

### U4. Web — extend `useInvoices`, add `useInvoiceStats`

**Goal:** Data hooks for the new query params and the counts endpoint.
**Requirements:** R4, R6.
**Dependencies:** U2, U3.
**Files:**
- `apps/web/src/hooks/useInvoices.ts` (extend `InvoiceListParams` + querystring building)
- `apps/web/src/hooks/useInvoiceStats.ts` (new)
- `apps/web/src/hooks/useInvoice.ts` (modify — invalidate `['invoice-stats']` in `useUpdateInvoice`/`useDeleteInvoice`)
- `apps/web/test/useInvoices.test.ts` (new or extend — assert querystring assembly)

**Approach:** Add `from?, to?, vendor?, sort?, order?` to `InvoiceListParams`; append them to the `URLSearchParams` only when set. Keep `retry: false` + `keepPreviousData` (Phase 3 review fixes). `useInvoiceStats` is a `useQuery(['invoice-stats'], () => apiClient('/api/invoices/stats'))` with `retry: false`; type the response with the shared enum keys — `{ counts: Record<InvoiceStatus, number>; total: number }` (import `InvoiceStatus` type from `@mac-invoices/shared`) so `StatusCounts` gets exhaustive-key checking, not loose `string`. Mutations that change status/delete must invalidate `['invoice-stats']` too — add that invalidation to `useUpdateInvoice`/`useDeleteInvoice` in `apps/web/src/hooks/useInvoice.ts` (singular — the mutation hooks live there, distinct from the list hook `useInvoices.ts`).
**Patterns to follow:** the existing `useInvoices` querystring assembly; CONV-003 (pages fetch via hooks only); the Phase 3 invalidation pattern in `useInvoice.ts`.
**Test scenarios:**
- `useInvoices` builds a querystring containing each provided param and omits absent ones (assert via a mocked `fetch`/`apiClient`).
- `useInvoiceStats` calls `/api/invoices/stats` and surfaces `counts`/`total`.
**Verification:** hooks compile, send correct querystrings, and stats invalidates after a status change.

### U5. Web — `FilterBar` + URL-synced list

**Goal:** The filter/sort UI, with URL as the source of truth, wired into `InvoiceList`.
**Requirements:** R4, R5.
**Dependencies:** U4.
**Files:**
- `apps/web/src/components/FilterBar.tsx` (new)
- `apps/web/src/pages/InvoiceList.tsx` (replace local `useState` with `useSearchParams`)
- `apps/web/src/lib/listParams.ts` (new — sanitize/parse URL params ↔ typed query, KTD-7)
- `apps/web/test/FilterBar.test.tsx` (new)
- `apps/web/test/InvoiceList.test.tsx` (extend)

**Approach:** `FilterBar` renders: status `<select>` (existing options), `from`/`to` date inputs, a debounced vendor text input, and sort field + order controls. It reads/writes via callbacks; `InvoiceList` owns `useSearchParams` and maps params → `useInvoices` args through `listParams.ts`, which **sanitizes** unknown/garbage values to defaults (KTD-7) and converts 1-based `page`→`offset`. Any filter change resets `page=1`. Preserve the existing loading-skeleton / error-retry / empty states; the empty state's "No invoices match this filter" + clear-filters action now clears the whole `FilterBar` (reset to `/invoices`).
**Patterns to follow:** the current `InvoiceList` states + pagination; the Phase 3 status `<select>`; `react-router` `useSearchParams`.
**Test scenarios:**
- Changing status/vendor/sort updates the URL search params (assert `useSearchParams` value or the issued query).
- Vendor input is debounced — rapid changes coalesce into one query (fake timers).
- A filter change resets to page 1.
- Pagination conversion: URL `?page=2` issues `offset = PAGE_SIZE` to `useInvoices`; `page=1` (or absent) issues `offset = 0` (guards the KTD-4 off-by-one).
- A garbage URL (`?sort=__bad__&from=xyz`) renders with defaults (sanitized) rather than erroring.
- Empty filtered result shows the "no match" state with a working clear-all that returns to the unfiltered list.
- Status-transition reachability (scope review): with the `FilterBar` rendered, each row's invoice-number link still navigates to `/invoices/:id` (where the Phase 3 action rail lives) — assert the row link's `href`/navigation survives the layout rework so the DoD's "status transitions" stays reachable.
**Verification:** filters/sort drive the list through the URL; refresh/back-button preserve state; states render correctly; the row→detail path (and thus mark-paid/dispute/delete) remains reachable; ≤2 interactions to reach a status+vendor view.

### U6. Web — status-counts strip + due-date metadata

**Goal:** The read-only counts dashboard strip (one-click status filter) and surfaced due-date in the table.
**Requirements:** R5, R6.
**Dependencies:** U4 (stats hook), U5 (URL status param).
**Files:**
- `apps/web/src/components/StatusCounts.tsx` (new)
- `apps/web/src/components/InvoiceTable.tsx` (add a Due column)
- `apps/web/src/pages/InvoiceList.tsx` (render `StatusCounts` above the table)
- `apps/web/test/StatusCounts.test.tsx` (new)
- `apps/web/test/InvoiceTable.test.tsx` (new or extend — due-date rendering)

**Approach:** `StatusCounts` consumes `useInvoiceStats`, renders one chip per status (label + count, reusing the `StatusBadge` color tokens) plus a total; clicking a chip sets the `status` URL param (and clears it when the active chip is re-clicked). `InvoiceTable` gains a **Due** column: `formatDate(dueDate)` or `—`; the `StatusBadge` already derives overdue from `dueDate`, so no new overdue logic. Strip is read-only otherwise (no mutation).
**Patterns to follow:** `StatusBadge` tokens + `lib/format` helpers; CONV-003.
**Test scenarios:**
- Strip renders a chip per status with the count from a mocked `useInvoiceStats`, and a correct total.
- Clicking a status chip sets the `status` search param; clicking the active chip clears it.
- `InvoiceTable` renders the due date when present and `—` when null; an overdue PENDING row still shows the Overdue badge (existing behavior, re-asserted at the table level).
**Verification:** counts strip reflects the stats endpoint, filters on click, and the table shows due dates; lint+typecheck+test green.

---

## UX & Accessibility Notes

Spec details for U5/U6 surfaced by design review — fold these into the components rather than leaving them to implementer guesswork:

- **FilterBar responsive (U5):** below `md:` the controls must not sit in a flat five-across row (unusable at ~375px). Stack them full-width vertically, or collapse behind a "Filters" toggle that opens a drawer/sheet with an active-filter count badge. Pick one and apply consistently; the sidebar is already `hidden md:flex`.
- **Two distinct empty states (U5):** distinguish *no invoices at all* (counts `total === 0`) — "No invoices yet" + create CTA — from *filtered-empty* (`total > 0`, list empty) — "No invoices match your filters" + clear-filters CTA. The all-time counts strip (KTD-5) makes this unambiguous. The current single "No invoices match this filter" copy conflates them.
- **Persistent clear-all (U5):** show a "Clear filters" affordance in the FilterBar whenever any non-default filter is active — not only inside the empty state (else the only reset path requires a zero-result filter). Clearing returns to `/invoices`.
- **Date range feedback (U5):** when `from > to`, give inline feedback (disable the query + "Start date must be before end date") rather than silently returning zero rows (indistinguishable from a legit empty match). Optionally set the `to` input's `min` to `from`.
- **Filter control labels (U5):** every control has an associated `<label>`/`aria-label` (`Filter by status`, `From date`, `To date`, `Filter by vendor`, `Sort by`, `Sort direction`); the asc/desc toggle's `aria-label` reflects current state. WCAG 1.3.1 (Level A).
- **Counts strip states + a11y (U6):** the active status chip carries `aria-pressed="true"` and a distinct visual state (not just color), with an `aria-label` including status + count; the strip has its own loading state (skeleton chips, to avoid layout shift while `useInvoiceStats` loads in parallel) and a graceful error/empty treatment so it never leaves a blank gap.
- **Counts strip hierarchy (U6):** render as secondary/summary chrome (muted, smaller) so full-intensity status colors don't out-rank the table data it summarizes.

---

## Scope Boundaries

**In scope:** the six units above — additive list query params, status-counts endpoint, URL-synced FilterBar, counts strip, due-date column, refined filtered-empty/error states.

**Out of scope (not this phase):**
- Phase 5 — Google Sheets export (`POST /invoices/export`, `sheetsSyncedAt`).
- Invoice image upload/view UI and OCR (DEC-016 deferral).
- Contractor app / roles beyond the landlord.
- Optimistic status updates (status transitions already work synchronously from Phase 3; not rebuilt here).

**Deferred to Follow-Up Work:**
- **Per-owner `invoiceNumber` uniqueness migration** (`@@unique([userId, invoiceNumber])`) — surfaced by the Phase 3 review as a cross-tenant oracle/DoS, but it is **gated on multi-user**, which is not in Phase 4. Schedule it with the contractor/multi-user phase.
- Vendor **picker** dropdown (distinct-vendors query) — deferred in favor of debounced free-text contains.
- Saved filters / multi-column sort / CSV of the filtered view.

---

## System-Wide Impact

- **API contract:** `GET /api/invoices` gains optional query params (additive, non-breaking). §7 already reserved `status,from,to,vendor,sort,page`, but two corrections are needed there: `order` (sort direction) is **net-new** and should be added to the §7 `GET /invoices` row alongside `sort`; and §7's `page` is the URL-facing param only — the API itself stays `limit`/`offset` (KTD-6), with `page→offset` converted client-side. Also **add a new §7 row** for `GET /invoices/stats` → `{ counts: Record<InvoiceStatus, number>, total }` (auth-required, all-time, ownership-scoped).
- **Shared package:** new `ListInvoicesQuerySchema` + sort/order enums consumed by both api and web (CONV-011).
- **Docs:** add **CONV-015** (list-query schema + whitelisted sort is the pattern for query validation) and **DEC-020** (URL-synced filter state; all-time counts; strict-API/sanitizing-client split) to `docs/CONVENTIONS.md` / `docs/DECISIONS.md` during execution. Tick the Phase 4 boxes in `PROJECT_PLAN.md §10`.

---

## Risks & Mitigations

- **Arbitrary `orderBy` injection** → whitelisted `sort`/`order` enums; `orderBy` built only from validated values (KTD-1).
- **Date off-by-one across timezones** → compare `invoiceDate` in UTC, `to` inclusive to end-of-day; consistent with the UTC `formatDate` and create-path coercion (KTD-2).
- **Hand-edited/garbage URL params 400-ing the page** → client sanitizes params to defaults before querying; API stays strict at the boundary (KTD-7).
- **Counts drifting from the list** → counts are intentionally all-time and independent (KTD-5); documented so the decoupling reads as deliberate, not a bug. Mutations invalidate `['invoice-stats']` (U4) so the strip stays fresh after status changes.
- **Sorting by nullable `dueDate`** → `dueDate` is nullable; Postgres places NULLs first on `desc`, floating no-due-date invoices to the top counterintuitively. Mitigation: build `orderBy` as a two-key array with `invoiceDate desc` as the tiebreaker (e.g., `[{ [sort]: order }, { invoiceDate: 'desc' }]`) so null-`dueDate` rows fall back to a stable order (U2).
- **`parseBody` error message is body-worded** → the shared validator throws `'Invalid request body'`; reused on `request.query` that message is slightly misleading. Low impact (the 400 + code are correct); if it matters, pass a query-specific message or use an inline `AppError('VALIDATION_ERROR', 'Invalid query params', 400)` (U2). Accepted as-is otherwise.
- **Unbounded date range (accepted risk)** → `from`/`to` have no max span. With the ownership-scoped query hitting `invoiceDate` (index scan, not full-table) and a single-landlord dataset, the cost is low; accepted for this phase rather than adding a max-window constraint. Revisit with multi-user/scale.

---

## Verification (Phase DoD)

- New integration tests cover each filter (status/date/vendor), sort, pagination interaction, and the counts endpoint — all ownership-scoped (CONV-012).
- The landlord can reach any status+vendor (or date-window) view in ≤2 interactions via the FilterBar / counts strip.
- `npm run lint && npm run typecheck && npm run test` green across `packages/shared`, `apps/api`, `apps/web` (CONV-007).
