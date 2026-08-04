# Spec — Continuous Google Sheets Sync (full mirror)

> Status: in progress. Realizes the DEC-001 data-flow item still marked "manual trigger
> for MVP / (Later) continuous sync via a background job after each mutation."

## Goal

Keep each landlord's connected Google Sheet **continuously in sync** with their invoices,
with no manual button press. The sheet becomes a **full mirror** of the landlord's
exportable invoices: new invoices appear, edits propagate, and deleted/withdrawn invoices
disappear — automatically, within the cron interval (~15 min, same cadence as the digest).

This replaces today's behavior, where export is manual (`POST /api/invoices/export`),
append-only + incremental, and **never re-pushes edited rows** (they only show a "drifted"
`SyncBadge`).

## Decisions (from product Q&A)

- **Full mirror** (new + edits + deletes), implemented as a per-user **clear + rewrite** each
  flush. Sidesteps id→row mapping; handles edits and deletes for free. Trade-off accepted:
  the mirror **overwrites any manual edits/annotations** a user makes directly in the sheet —
  the sheet is a read-only reporting surface, Postgres is the source of truth (DEC-001).
- **Periodic cron flush** (not synchronous-on-mutation): serverless-safe, keeps Google API
  latency/429s off the invoice write path. Mirrors the existing contractor-digest cron
  (`/api/cron/notify-digest`, `CRON_SECRET`-gated, scheduled by GitHub Actions).

## Scope of what syncs

Same row set and columns as today's export (single source of truth: `EXPORT_COLUMNS`):

1. **Rows:** the user's invoices with `status NOT IN (SUBMITTED, REJECTED, CANCELLED)` —
   only real spend (PENDING/APPROVED/PAID). Contractor submissions awaiting approval,
   rejected, and withdrawn invoices are never mirrored.
2. **Columns (order):** `invoiceNumber, invoiceDate, description, propertyAddress, amount,
   category, status, notes, partsOrdered, invoiceLink` (2026-08-04 plan: the internal `id`
   and `vendorName` are no longer exported; `invoiceLink` renders as a `HYPERLINK` "Link"
   cell and stays last). The mirror writes a **header row** first (human-friendly labels),
   then data — because clear+rewrite wipes any operator-added header.
3. **Row order:** ascending by invoice number, numeric-aware (`"9" < "10"` — the column is a
   string per DEC-023, so the sort is an in-memory natural-order comparator). Un-numbered
   invoices (number is stamped on first APPROVED) sort last, by invoice date then id.
4. **Dropdowns:** every mirror re-applies data-validation rules (one `batchUpdate`: clear all
   validation from rows 2+, then `ONE_OF_LIST` rules) — Status = PENDING/APPROVED/PAID,
   Category = the six categories, Property = the landlord's addresses (trimmed, deduped,
   natural-sorted; a landlord with zero properties gets no Property rule). Requires the
   tab's numeric `sheetId`, resolved per pass via `spreadsheets.get` (exact title match; a
   miss fails with `SHEET_TAB_NOT_FOUND` **before** the destructive clear). Sheet edits
   still never flow back (DEC-001) — dropdowns are a consistency aid.

## Target spreadsheet — per user

Continuous sync targets **`User.sheetSpreadsheetId`** only (set in Settings → Sheets).
It does **not** fall back to the server-wide `GOOGLE_SHEET_ID` env, because a full
clear+rewrite against a shared sheet would let multiple users clobber each other. A user
with no saved `sheetSpreadsheetId` is skipped by the cron. (The manual "Sync now" button
surfaces a clear error telling them to connect a sheet in Settings.)

> Migration note for the current single landlord: set the spreadsheet id once in
> Settings → Sheets (the env `GOOGLE_SHEET_ID` remains a fallback for nothing now —
> continuous sync ignores it).

## Dirtiness detection (skip unchanged users)

Rewriting every user's whole sheet every 15 min regardless of change wastes Sheets quota.
A user is **dirty** (needs a flush) when their latest change is newer than the last
successful mirror high-water mark `User.sheetSyncedAt`:

```
lastChange = max(
  newest Invoice.updatedAt where userId = u,          // covers create + ANY field edit
  newest InvoiceEvent.createdAt where ownerUserId = u and type = DELETED   // covers deletes
)
dirty = sheetSyncedAt is null OR lastChange > sheetSyncedAt
```

`Invoice.updatedAt` (Prisma `@updatedAt`) covers creates and **all** field edits — including
fields that don't emit an `InvoiceEvent` (e.g. `description`, `partsOrdered`). Deletes remove
the invoice row, so the `DELETED` tombstone event (which outlives the invoice — no FK) is the
delete signal. A user with zero invoices and no deletes since last sync is not dirty.

## Flush algorithm (per dirty user)

1. `flushStart = new Date()` — captured **before** the read, so a mutation racing the flush
   re-triggers next run (eventual consistency, at-least-once).
2. Resolve the pinned tab's `sheetId` (`resolveSheetTabId` — fails fast before any write).
3. Read exportable invoices (filter + `include: { property: { address } }`) and the
   landlord's property addresses; sort invoices with `compareForExport` (invoice number
   ascending, natural order, nulls last).
4. Build rows: `[header, ...dataRows]`. `overwriteRows(target, rows)` = **clear the tab, then
   `values.update` at `A1`** (formula-injection-guarded, retry/backoff on 429/5xx reused from
   the append path). Then `applyColumnDropdowns(target, sheetId, dropdownSpecs(addresses))`
   re-applies the validation rules (idempotent; a failure here also keeps the user dirty).
5. Stamp: `User.sheetSyncedAt = flushStart` and `Invoice.sheetsSyncedAt = flushStart` for the
   mirrored ids. Stamping to `flushStart` (not `now()`) keeps the `SyncBadge` honest: an
   invoice edited during the flush has `updatedAt > sheetsSyncedAt` → shows "drifted" → picked
   up next run.

**Ordering & idempotency:** overwrite THEN stamp. A death between them leaves the user dirty,
and the next run re-mirrors — clear+rewrite is **idempotent**, so a redundant re-mirror is
harmless. Per-user `try/catch`: one user's `SHEET_PERMISSION_DENIED`/429 is counted and does
not crash the job or block other users (same isolation as `runDigestFlush`).

## API contract

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/api/cron/sync-sheets` | `Authorization: Bearer <CRON_SECRET>` (fails closed) | — | `{ users, synced, skipped, failed }` |
| POST | `/api/invoices/export` | session | `{ spreadsheetId? }` (ignored now) | `{ exported: n }` — **repointed to a full mirror of the caller** ("Sync now"); `n` = data rows written |

`SyncBadge` semantics unchanged from the UI's perspective (synced / drifted / not-exported),
now driven by the automatic mirror instead of a manual append.

## Acceptance criteria (tests — seam-mock `integrations/sheets`)

- [ ] `POST /api/cron/sync-sheets` returns 401 without/with-wrong Bearer, and when `CRON_SECRET`
      is unset (fails closed).
- [ ] A user with a saved sheet and a new invoice → mirror called once with their target,
      payload = header + that row; `sheetSyncedAt` advances.
- [ ] An unchanged user (no change since `sheetSyncedAt`) → mirror **not** called (skipped).
- [ ] Editing an already-synced invoice re-mirrors it on the next flush (drift propagates).
- [ ] Deleting an invoice removes it from the next mirror (row absent).
- [ ] A user with no `sheetSpreadsheetId` is skipped (cron) / errors clearly (manual).
- [ ] One user's Sheets failure is isolated: `failed` counts it, other users still `synced`.
- [ ] Idempotency: overwrite succeeds but stamp throws → next run re-mirrors, no dup/loss.
- [ ] `POST /api/invoices/export` performs a full mirror of the caller (not append-only).

## Out of scope

- Real-time/synchronous sync (rejected: serverless latency/429 on the write path).
- Preserving manual in-sheet edits (full mirror overwrites them — by decision).
- Bi-directional sync / Sheets-as-import (DEC-001: Sheets is export-only).
