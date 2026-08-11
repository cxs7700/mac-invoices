---
date: 2026-08-10
topic: sheets-table-aware-mirror
---

# Table-Aware Sheets Mirror — Requirements

## Summary

When a landlord's Invoices tab holds a Google Sheets **Table**, the mirror must
write its rows *inside* that table, so every row carries the table's banding,
column types and filter membership. Today the mirror writes values with no
knowledge of the table's extent, so any row past the table's last row lands
outside it as bare, unformatted grid. The fix is to read the table's range in the
lookup that already runs each pass, and resize it — up **and** down — to exactly
match the rows about to be written, before writing them.

---

## Problem Frame

`mirrorUserSheet` (`apps/api/src/invoices/sheetSync.ts:74-119`) runs a fixed
sequence each pass: `resolveSheetTab`, then `overwriteRows`
(`apps/api/src/integrations/sheets.ts:280-297`) which does `values.clear` on the
whole tab followed by `values.update` anchored at `A1`, then
`applyColumnDropdowns`.

None of those three calls knows the table's row extent. `resolveSheetTab` does
read `tables`, but only `columnProperties` — DEC-026(f) added that to learn which
columns are *typed*, because typed columns reject classic `setDataValidation`.
The table's `range` was never needed and was never requested.

The consequence shows up as soon as the landlord's invoice count passes the
table's height. A table covering rows 1–40 with a mirror writing 60 rows leaves
rows 41–60 outside the table: no banding, no typed columns, not part of the
table for sort or filter. The values are correct; the sheet looks broken, and
looks broken in a way that grows worse with every invoice added.

`values.clear` and `values.update` do not move a table's boundary — only an
explicit `updateTable` does. So the mirror will never converge on its own.

---

## Decisions

### Resize symmetrically — grow and shrink

The table's range is set to exactly the rows the mirror is about to write, every
pass. When the invoice count drops, the table shrinks with it.

The alternative, growing only, avoids ever taking rows away from the landlord —
but the sheet is a declared full mirror that clears the tab on every pass
(DEC-001), so a table left stretched over just-cleared rows renders as empty
banded rows carrying stale typed-column validation. That reads as a bug.

Shrinking loses no history: Google Sheets' own version history retains prior
revisions, which is where a deleted invoice would be recovered from anyway.
Postgres remains the source of truth regardless.

### A tab with no table keeps today's behavior exactly

The table is the landlord's own artifact, created in the Sheets UI. If there
isn't one, the mirror stays a values-only writer and nothing changes. The new
code is a strict no-op on unstyled sheets.

Rejected: creating a table on first sync. It imposes structure on someone else's
spreadsheet, requires a name and style the landlord never chose, and an unwanted
table is tedious to undo.

### Only a table anchored at A1 is managed

A table qualifies only if its range starts at row 0 **and** column 0 — the one
geometry the mirror's `A1` write aligns with. A table at `C5`, or a second table
lower down the tab, is ignored: `table` resolves to `null` and the pass proceeds
as it does today. The values write still succeeds.

Guessing at a misaligned table's intent would mean resizing a range the mirror
does not write into.

---

## Design

### `resolveSheetTab` also returns the table

The single `spreadsheets.get` per pass widens its `fields` mask to:

```
sheets(properties(sheetId,title),tables(tableId,range,columnProperties(columnIndex,columnType)))
```

`SheetTab` gains:

```ts
table: { tableId: string; endColumnIndex: number } | null
```

Only the id (to address the resize) and the column extent (to preserve it) are
carried. The row extent is replaced every pass, so reading it would be dead
weight.

The anchor check lives here, and must read absent coordinates as zero:

```ts
(range.startRowIndex ?? 0) === 0 && (range.startColumnIndex ?? 0) === 0
```

`GridRange` omits `startRowIndex`/`startColumnIndex` when they are `0` (proto3
default), so **absent is the anchored case**. This is the same trap the existing
`columnIndex ?? 0` comment at `sheets.ts:194` already records for
`columnProperties`.

### `resizeTableRows`

New export in `integrations/sheets.ts`:

```ts
resizeTableRows(spreadsheetId, table, dataRowCount): Promise<void>
```

One `batchUpdate` carrying a single `updateTable` request with `fields: 'range'`,
setting the range to rows `0 … 1 + max(dataRowCount, 1)` and columns
`0 … table.endColumnIndex`. It runs inside the shared `withRetry` policy, like
every other call in the module, so a failure surfaces as a sanitized `AppError`.

`max(dataRowCount, 1)` exists because a table cannot be header-only: a landlord
with zero exportable invoices gets a one-row table rather than a Google 400.

Shrinking needs no branch — it is the same request with a smaller row count.

### Call order

`mirrorUserSheet` becomes:

1. `resolveSheetTab` — gid, typed columns, table (unchanged position: still
   before anything destructive, so a missing tab fails before the clear)
2. `overwriteRows(…, tab)` — internally: `values.clear`, then
   `resizeTableRows` (skipped entirely when `table` is `null`), then
   `values.update` at `A1`
3. `applyColumnDropdowns`

The resize lives *inside* `overwriteRows` rather than as a separate step in
`mirrorUserSheet`, so the clear/resize/write sequence stays owned by one
function.

**The resize precedes the write.** It mirrors what a person does in the UI —
extend the table, then type into rows that are born formatted. More concretely,
growing a table *over* cells that already hold values asks Google to retro-fit a
typed column (`DATE`, `DOUBLE`, `DROPDOWN`) onto text it never validated;
shaping the destination first means `values.update` writes into columns that
already carry their types, which is the direction DEC-026(f) established works.

Rejected: folding the resize into the existing `applyColumnDropdowns`
`batchUpdate` to hold the call count at 3. Same wire cost, but it forces the
resize to step 5 — precisely the grow-over-existing-values case above.

### Cost and failure semantics

Quota per dirty user goes to 4 writes + 1 read, from 3 + 1. Far under the
60/min/user limit.

A resize failure throws between the clear and the write, leaving the tab empty
and the user un-stamped — identical to a `values.update` failure today. The next
cron pass re-mirrors idempotently (DEC-024, at-least-once).

---

## Testing

`apps/api/test/integrations/sheets.test.ts` already mocks `googleapis` and
asserts on both the `fields` mask and request bodies.

**`resolveSheetTab`**
- the widened `fields` string
- a table anchored at `A1` returns `{tableId, endColumnIndex}`
- a table whose range **omits** `startRowIndex`/`startColumnIndex` is treated as
  anchored — the proto3 trap, and the test that catches a dropped `?? 0`
- a table at `C5` returns `table: null`
- two tables, only one anchored → the anchored one is chosen
- a tab with no tables returns `null`
- existing assertions gain `table: null` in their expected objects

**`resizeTableRows`**
- the `updateTable` body for N rows
- `endRowIndex` floors at 2 when N is 0
- shrinking emits the same request with a smaller N

**`sheets.sync.test.ts`**
- the mirror calls the resize between clear and update when a table exists
- the mirror skips it entirely when no table exists

---

## Out of Scope

No changes to `sheetRows.ts`, `packages/shared`, the web app, or the Prisma
schema. Column order, row order, dropdown rules and the exportable-status filter
are all untouched.

---

## Documentation

- **DEC-026(g)** in `docs/DECISIONS.md`, continuing the Tables thread (f) opened.
- A note in `docs/SHEETS_EXPORT.md` that a landlord's table is grown and shrunk
  to match the mirror, stating the `A1` anchor requirement — a table not anchored
  there is silently ignored, and that is the one behavior a landlord could be
  surprised by.
