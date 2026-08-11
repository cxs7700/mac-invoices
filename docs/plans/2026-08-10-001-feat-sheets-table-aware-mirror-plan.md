# Table-Aware Sheets Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Google Sheets mirror resize a landlord's Sheets **Table** to exactly the rows it writes, so every mirrored row sits inside the table and carries its formatting, banding and column types.

**Architecture:** `resolveSheetTab` — the one `spreadsheets.get` already made per pass — additionally returns the tab's A1-anchored table (`tableId` + column extent), or `null`. `overwriteRows` gains that tab as a third argument and, between its existing `values.clear` and `values.update`, issues one `updateTable` `batchUpdate` sizing the table to `header + N` rows. A tab with no anchored table takes the `null` branch and behaves exactly as it does today.

**Tech Stack:** Fastify 5, Prisma + PostgreSQL, `googleapis` (Sheets v4), Vitest.

**Spec:** `docs/brainstorms/2026-08-10-sheets-table-aware-mirror-requirements.md`

## Global Constraints

- **Node 20 is the shell default and breaks Prisma and the test tooling.** Start any shell with:
  `export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"` — confirm `node -v` prints `v24.12.0`.
- **NEVER run the api suite without the local DATABASE_URL override.** The repo-root `.env` `DATABASE_URL` points at the **production** database. Only correct form:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
- **Never run `npm run test` from the repo root.**
- **Never run migrations, `db:deploy`, or `db:push` in this plan.** There is no schema change.
- **Local Postgres** runs on port **5433** (`docker compose up -d`); a native host Postgres shadows 5432.
- **The api suite has a known pre-existing flake** (~1 run in 3) from a race on the shared landlord row. If a failure is in a test this plan never touched, re-run once before investigating; say so in your report.
- **Commits go directly on `main`.** No feature branch. Do not push — the user pushes when they ask.
- **Do not `git add -A`.** A `.claude/` and a `.superpowers/` directory exist in this tree and must never be committed.
- **Never widen the error surface.** Every Google call in `integrations/sheets.ts` goes through `withRetry`, which sanitizes provider errors. A raw gaxios error can embed `private_key` / `client_email` and the central error handler logs whatever is thrown (KTD-1b). New calls follow the same rule; tests assert the private key never appears in a thrown error.
- Definition of Done: `npm run lint && npm run typecheck` green, plus the api suite.

## Background an implementer needs

The Sheets mirror is a **full mirror**, not an append log: every pass clears the pinned tab and rewrites the header plus one row per exportable invoice (DEC-001, DEC-024). Postgres is the source of truth; sheet edits never flow back.

A Google Sheets **Table** is a first-class object with its own rectangular `range`, banding, and per-column *types*. It is created by the landlord in the Sheets UI — the mirror never creates one. Writing values into cells below a table does **not** extend it; only an explicit `updateTable` request moves its boundary. That is the entire bug: a table covering rows 1–40 with 60 rows mirrored leaves rows 41–60 outside it.

DEC-026(f) already recorded the first Tables collision: classic `setDataValidation` is rejected on *typed* table columns, so `resolveSheetTab` returns `typedColumnIndexes` and `applyColumnDropdowns` skips them. This plan is the second chapter of that thread.

**The `GridRange` proto3 trap.** The Sheets API omits an integer field when its value is `0`. So a table anchored at `A1` comes back with **no** `startRowIndex` and **no** `startColumnIndex` at all. Absent means zero, which means anchored. Reading absence as "not anchored" would disable the feature for exactly the tables it targets. The same trap is already commented at `apps/api/src/integrations/sheets.ts:194` for `columnIndex`.

## File Structure

- `apps/api/src/integrations/sheets.ts` — **modify.** Owns every Google call and the retry/sanitize policy. Gains the table in `SheetTab`, a `resizeTableRows` export, and the resize step inside `overwriteRows`. This is the only file that talks to Google.
- `apps/api/src/invoices/sheetSync.ts` — **modify, one line.** Passes the already-resolved `tab` into `overwriteRows`.
- `apps/api/test/integrations/sheets.test.ts` — **modify.** Unit coverage for the lookup, the resize request, and the call ordering. `googleapis` is mocked here, so ordering is directly assertable.
- `apps/api/test/sheets.sync.test.ts` — **modify.** Mocks the integration module wholesale; asserts the mirror hands the resolved tab to `overwriteRows`.
- `apps/api/test/invoices.export.test.ts`, `apps/api/test/settings.sheets.test.ts` — **modify, mock shape only.**
- `docs/DECISIONS.md`, `docs/SHEETS_EXPORT.md` — **modify.** DEC-026(g) and the landlord-facing note.

### Deviation from the spec, and why

The spec lists the resize as step 3 of a five-step `mirrorUserSheet`. Implemented literally, that requires splitting `overwriteRows` into a separate clear and write at the caller, which breaks the documented "NOT atomic across the two calls" contract that lives on that function and spreads Google-call sequencing into the sync module.

Instead the resize goes **inside** `overwriteRows`, which takes the tab as a third argument. The observable sequence — clear, resize, write — is exactly what the spec specifies, and the ordering becomes directly unit-testable in the file where `googleapis` is mocked. Task 4 amends the spec doc to match.

---

### Task 1: `resolveSheetTab` returns the A1-anchored table

**Files:**
- Modify: `apps/api/src/integrations/sheets.ts:157-199`
- Test: `apps/api/test/integrations/sheets.test.ts:203-288`
- Modify (mock shape only): `apps/api/test/sheets.sync.test.ts:8,72,194`, `apps/api/test/invoices.export.test.ts:18`, `apps/api/test/settings.sheets.test.ts:12`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type SheetTable = { tableId: string; endColumnIndex: number }
  export type SheetTab = {
    sheetId: number
    typedColumnIndexes: number[]
    table: SheetTable | null
  }
  export function resolveSheetTab(spreadsheetId: string): Promise<SheetTab>
  ```
  Tasks 2 and 3 consume `SheetTab` including the new `table` field.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('sheets.resolveSheetTab', …)` block in `apps/api/test/integrations/sheets.test.ts`:

```ts
  it('returns the A1-anchored table — start indexes OMITTED is the anchored case', async () => {
    // The API omits startRowIndex/startColumnIndex when they are 0 (proto3
    // default), so an absent anchor is the table we manage, not a miss.
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 4, title: 'Invoices' },
            tables: [{ tableId: 'tbl-1', range: { sheetId: 4, endRowIndex: 41, endColumnIndex: 10 } }],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 4,
      typedColumnIndexes: [],
      table: { tableId: 'tbl-1', endColumnIndex: 10 },
    })
  })

  it('requests the table range in the fields mask', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 1, title: 'Invoices' }]))
    await resolveSheetTab('SHEET-1')
    expect(getMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      fields:
        'sheets(properties(sheetId,title),tables(tableId,range,columnProperties(columnIndex,columnType)))',
    })
  })

  it('accepts an anchor written out explicitly as 0', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              {
                tableId: 'tbl-2',
                range: { startRowIndex: 0, startColumnIndex: 0, endRowIndex: 9, endColumnIndex: 10 },
              },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({
      table: { tableId: 'tbl-2', endColumnIndex: 10 },
    })
  })

  it('ignores a table that is not anchored at A1', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              {
                tableId: 'tbl-3',
                range: { startRowIndex: 4, startColumnIndex: 2, endRowIndex: 40, endColumnIndex: 12 },
              },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({ table: null })
  })

  it('picks the anchored table when the tab holds more than one', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              { tableId: 'lower', range: { startRowIndex: 50, endRowIndex: 60, endColumnIndex: 4 } },
              { tableId: 'anchored', range: { endRowIndex: 20, endColumnIndex: 10 } },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({
      table: { tableId: 'anchored', endColumnIndex: 10 },
    })
  })

  it('ignores an anchored table with no id or no column extent — it cannot be resized', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              { range: { endRowIndex: 20, endColumnIndex: 10 } }, // no tableId
              { tableId: 'no-width', range: { endRowIndex: 20 } }, // no endColumnIndex
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({ table: null })
  })

  it('a tab with no tables at all resolves table: null', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 3, title: 'Invoices' }]))
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 3,
      typedColumnIndexes: [],
      table: null,
    })
  })
```

Then update the three **existing** `resolveSheetTab` assertions that use exact `toEqual`, since the resolved object gains a field:
- line 215-218 → add `table: null` to the expected object
- line 228 → `resolves.toEqual({ sheetId: 0, typedColumnIndexes: [], table: null })`
- line 271-274 → add `table: null` to the expected object

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- test/integrations/sheets.test.ts
```

Expected: FAIL. The new tests fail because the resolved object has no `table` key; the fields-mask test fails on the old mask string.

- [ ] **Step 3: Widen the type and the fields mask**

In `apps/api/src/integrations/sheets.ts`, replace the `SheetTab` type at line 157-161 (keep the existing doc comment above it and extend it):

```ts
/** The pinned tab's grid id, the column indexes a Sheets "Table" has given a
 * type (DOUBLE, DATE, DROPDOWN, …), and the table itself when one is anchored
 * at A1. Typed columns reject classic data validation ("not allowed on cells in
 * typed columns"), so rule specs for them are skipped — their dropdowns come
 * from the table's own column type. */
export type SheetTable = { tableId: string; endColumnIndex: number }
export type SheetTab = {
  sheetId: number
  typedColumnIndexes: number[]
  table: SheetTable | null
}
```

In `resolveSheetTab`, change the `fields` string (line 180) to:

```ts
        fields:
          'sheets(properties(sheetId,title),tables(tableId,range,columnProperties(columnIndex,columnType)))',
```

- [ ] **Step 4: Add the anchor check and return it**

Add above `resolveSheetTab` in the same file:

```ts
/**
 * The one table this mirror manages: the table anchored at A1, which is the
 * only geometry the mirror's `A1` values write aligns with. A table elsewhere
 * on the tab (or a second table below the data) is left entirely alone.
 *
 * A GridRange OMITS startRowIndex/startColumnIndex when they are 0 (proto3
 * default) — so an absent anchor IS the anchored case, not a miss. Reading
 * absence as "not anchored" would silently disable the resize for precisely
 * the tables it exists to serve. Same trap as `columnIndex ?? 0` below.
 *
 * A table with no id, or no column extent, cannot be addressed or resized, so
 * it is treated as absent.
 */
function anchoredTable(
  tables: NonNullable<sheets_v4.Schema$Sheet['tables']>,
): SheetTable | null {
  for (const t of tables) {
    const range = t.range
    if (!range) continue
    if ((range.startRowIndex ?? 0) !== 0 || (range.startColumnIndex ?? 0) !== 0) continue
    if (typeof t.tableId !== 'string' || typeof range.endColumnIndex !== 'number') continue
    return { tableId: t.tableId, endColumnIndex: range.endColumnIndex }
  }
  return null
}
```

Then change the return at line 198 to:

```ts
  return { sheetId, typedColumnIndexes, table: anchoredTable(match?.tables ?? []) }
```

- [ ] **Step 5: Fix the four mock/assertion sites the widened type breaks**

`SheetTab` now has a required `table`, so every object literal typed as one must carry it. Update:

- `apps/api/test/sheets.sync.test.ts:8` and `:72` → `{ sheetId: 123, typedColumnIndexes: [], table: null }`
- `apps/api/test/sheets.sync.test.ts:194` → `expect(call[1]).toEqual({ sheetId: 123, typedColumnIndexes: [], table: null })`
- `apps/api/test/invoices.export.test.ts:18` → `{ sheetId: 123, typedColumnIndexes: [], table: null }`
- `apps/api/test/settings.sheets.test.ts:12` → `{ sheetId: 123, typedColumnIndexes: [], table: null }`
- `apps/api/test/integrations/sheets.test.ts` lines 292, 336, 348, 357, 364 — the `applyColumnDropdowns` calls pass a `SheetTab` literal; add `table: null` to each.

- [ ] **Step 6: Run the api suite and the type-check**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
npm run typecheck
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
```

Expected: PASS, both.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integrations/sheets.ts apps/api/test/integrations/sheets.test.ts \
        apps/api/test/sheets.sync.test.ts apps/api/test/invoices.export.test.ts \
        apps/api/test/settings.sheets.test.ts
git commit -m "feat(api): resolve the tab's A1-anchored Sheets Table alongside its gid"
```

---

### Task 2: `resizeTableRows`

**Files:**
- Modify: `apps/api/src/integrations/sheets.ts` (new export, place it directly after `applyColumnDropdowns`)
- Test: `apps/api/test/integrations/sheets.test.ts` (new `describe` block after `sheets.applyColumnDropdowns`)

**Interfaces:**
- Consumes: `SheetTab` / `SheetTable` from Task 1.
- Produces:
  ```ts
  export function resizeTableRows(
    spreadsheetId: string,
    tab: SheetTab,
    dataRowCount: number,
  ): Promise<void>
  ```
  A no-op (zero API calls) when `tab.table` is `null`. Task 3 calls this.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `apps/api/test/integrations/sheets.test.ts`, after the `sheets.applyColumnDropdowns` block:

```ts
describe('sheets.resizeTableRows', () => {
  const withTable = {
    sheetId: 123,
    typedColumnIndexes: [],
    table: { tableId: 'tbl-1', endColumnIndex: 10 },
  }

  it('sizes the table to the header plus N data rows in one updateTable', async () => {
    await resizeTableRows('SHEET-1', withTable, 60)
    expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    expect(batchUpdateMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      requestBody: {
        requests: [
          {
            updateTable: {
              table: {
                tableId: 'tbl-1',
                range: {
                  sheetId: 123,
                  startRowIndex: 0,
                  endRowIndex: 61,
                  startColumnIndex: 0,
                  endColumnIndex: 10,
                },
              },
              fields: 'range',
            },
          },
        ],
      },
    })
    expect(batchUpdateMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('SHRINKS with the same request when the invoice count drops', async () => {
    await resizeTableRows('S', withTable, 3)
    const range = batchUpdateMock.mock.calls[0][0].requestBody.requests[0].updateTable.table.range
    expect(range.endRowIndex).toBe(4)
  })

  it('floors at one data row — a table cannot be header-only', async () => {
    await resizeTableRows('S', withTable, 0)
    const range = batchUpdateMock.mock.calls[0][0].requestBody.requests[0].updateTable.table.range
    expect(range.endRowIndex).toBe(2)
  })

  it('does nothing at all when the tab has no anchored table', async () => {
    await resizeTableRows('S', { sheetId: 0, typedColumnIndexes: [], table: null }, 5)
    expect(batchUpdateMock).not.toHaveBeenCalled()
  })

  it('sanitizes a Google failure and never leaks the private key', async () => {
    batchUpdateMock.mockReset().mockRejectedValue({ code: 403, key: 'PRIVATE-SECRET-123' })
    const err = await resizeTableRows('S', withTable, 5).catch((e) => e)
    expect(err).toMatchObject({ code: 'SHEET_PERMISSION_DENIED', statusCode: 502 })
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })
})
```

Add `resizeTableRows` to the import list at the top of the file (line 22-27).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- test/integrations/sheets.test.ts
```

Expected: FAIL — `resizeTableRows is not a function`.

- [ ] **Step 3: Implement it**

In `apps/api/src/integrations/sheets.ts`, after `applyColumnDropdowns`:

```ts
/**
 * Size the tab's anchored Sheets Table to exactly the rows the mirror is about
 * to write — header + `dataRowCount` — in one `updateTable`. GROWS and SHRINKS:
 * the sheet is a full mirror that clears the tab every pass (DEC-001), so a
 * table left stretched over just-cleared rows would render as empty banded rows
 * carrying stale typed-column validation. Deleted rows remain recoverable from
 * Google's own version history; Postgres stays the source of truth.
 *
 * A no-op when the tab has no A1-anchored table — the mirror then behaves as a
 * plain values writer, which is the whole behavior for landlords who never made
 * a table. The column extent is the table's own: this resizes rows, and never
 * silently re-widens or narrows a landlord's columns.
 *
 * `Math.max(dataRowCount, 1)` because a table cannot be header-only — a landlord
 * with zero exportable invoices would otherwise trigger a Google 400.
 */
export async function resizeTableRows(
  spreadsheetId: string,
  tab: SheetTab,
  dataRowCount: number,
): Promise<void> {
  const { table } = tab
  if (!table) return
  const sheets = getSheetsClient()
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate(
      {
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateTable: {
                table: {
                  tableId: table.tableId,
                  range: {
                    sheetId: tab.sheetId,
                    startRowIndex: 0,
                    endRowIndex: 1 + Math.max(dataRowCount, 1),
                    startColumnIndex: 0,
                    endColumnIndex: table.endColumnIndex,
                  },
                },
                fields: 'range',
              },
            },
          ],
        },
      },
      { timeout: 30_000 },
    ),
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- test/integrations/sheets.test.ts
```

Expected: PASS.

If the `updateTable` request fails to type-check against the installed `googleapis` (the Tables API is newer than much of the v4 surface), do **not** cast the whole request body to `any` — narrow it: type the request array as `sheets_v4.Schema$Request[]` exactly as `applyColumnDropdowns` does at line 220, and report the diagnostic in your task report if that is still insufficient.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/sheets.ts apps/api/test/integrations/sheets.test.ts
git commit -m "feat(api): add resizeTableRows — size a Sheets Table to the mirrored rows"
```

---

### Task 3: The mirror resizes between the clear and the write

**Files:**
- Modify: `apps/api/src/integrations/sheets.ts:271-297` (`overwriteRows`)
- Modify: `apps/api/src/invoices/sheetSync.ts:99`
- Test: `apps/api/test/integrations/sheets.test.ts:149-201` (`sheets.overwriteRows` block)
- Test: `apps/api/test/sheets.sync.test.ts`

**Interfaces:**
- Consumes: `resizeTableRows` and `SheetTab` from Tasks 1-2.
- Produces:
  ```ts
  export function overwriteRows(
    spreadsheetId: string,
    rows: SheetCell[][],
    tab: SheetTab,
  ): Promise<void>
  ```
  `tab` is **required** — `mirrorUserSheet` is the only caller and always has it.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/integrations/sheets.test.ts`, add to the `describe('sheets.overwriteRows (full mirror)', …)` block:

```ts
  const tabWithTable = {
    sheetId: 123,
    typedColumnIndexes: [],
    table: { tableId: 'tbl-1', endColumnIndex: 10 },
  }

  it('resizes the table AFTER the clear and BEFORE the write', async () => {
    // Order is the whole point: growing a table over cells that already hold
    // values asks Google to retro-fit a typed column onto unvalidated text.
    await overwriteRows('S', [['h'], ['a'], ['b']], tabWithTable)
    expect(clearMock.mock.invocationCallOrder[0]).toBeLessThan(
      batchUpdateMock.mock.invocationCallOrder[0],
    )
    expect(batchUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateMock.mock.invocationCallOrder[0],
    )
  })

  it('sizes the table to the DATA rows, excluding the header row', async () => {
    await overwriteRows('S', [['h'], ['a'], ['b']], tabWithTable)
    const range = batchUpdateMock.mock.calls[0][0].requestBody.requests[0].updateTable.table.range
    expect(range.endRowIndex).toBe(3) // header + 2 data rows
  })

  it('clears and writes exactly as before when the tab has no table', async () => {
    await overwriteRows('S', [['h'], ['a']], { sheetId: 0, typedColumnIndexes: [], table: null })
    expect(clearMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(batchUpdateMock).not.toHaveBeenCalled()
  })

  it('a resize failure aborts before the write', async () => {
    batchUpdateMock.mockReset().mockRejectedValue({ code: 403 })
    await expect(overwriteRows('S', [['h'], ['a']], tabWithTable)).rejects.toMatchObject({
      code: 'SHEET_PERMISSION_DENIED',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })
```

The existing `overwriteRows` calls in that block (and anywhere else in the file) need the third argument — pass `{ sheetId: 0, typedColumnIndexes: [], table: null }` so their assertions keep their current meaning.

In `apps/api/test/sheets.sync.test.ts`, add to the `describe('continuous Sheets sync flush', …)` block. It uses the file's existing `makeLandlord()` / `makeInvoice()` / `callsFor()` helpers (defined at the top of that file — `makeLandlord` already generates a unique `sheetSpreadsheetId`, which matters because that column is UNIQUE, DEC-033):

```ts
  it('hands the resolved tab to overwriteRows so the table is resized in the same pass', async () => {
    const l = await makeLandlord()
    await makeInvoice(l.id)
    const tab = {
      sheetId: 123,
      typedColumnIndexes: [],
      table: { tableId: 'tbl-1', endColumnIndex: 10 },
    }
    resolveSheetTab.mockResolvedValue(tab)

    await runSheetsSyncFlush(app.prisma)

    expect(callsFor(l.target)[0][2]).toEqual(tab)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- test/integrations/sheets.test.ts test/sheets.sync.test.ts
```

Expected: FAIL — no `batchUpdate` is issued by `overwriteRows`, and `call[2]` is `undefined`.

- [ ] **Step 3: Thread the tab through `overwriteRows`**

In `apps/api/src/integrations/sheets.ts`, replace the signature and body of `overwriteRows` (keep the existing doc comment and extend it as shown):

```ts
/**
 * Replace the pinned tab's entire contents with `rows` — the continuous-sync
 * full mirror. Clears the tab, sizes the tab's Sheets Table to fit (a no-op when
 * there is no anchored table), THEN writes (`values.update` at A1), so deleted
 * invoices vanish and edits land in place; pass a header row as `rows[0]` since
 * the clear wipes any operator-added header. The resize sits BETWEEN the clear
 * and the write on purpose: it mirrors what a person does in the UI — extend the
 * table, then type into rows that are born formatted — and it means
 * `values.update` writes into columns that already carry their types, rather
 * than asking Google to retro-fit a type onto text it never validated.
 *
 * Each Google call carries the shared retry/backoff + sanitize policy. NOT
 * atomic across the calls: a failure after the clear leaves the tab empty, but
 * the caller is the cron mirror which re-runs idempotently (the user stays
 * "dirty" until a full pass succeeds).
 */
export async function overwriteRows(
  spreadsheetId: string,
  rows: SheetCell[][],
  tab: SheetTab,
): Promise<void> {
  const sheets = getSheetsClient()
  const safeRows = rows.map((row) => row.map(safeCell))
  await withRetry(() =>
    sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName() }, { timeout: 30_000 }),
  )
  // rows[0] is the header, which lives inside the table but is not a data row.
  await resizeTableRows(spreadsheetId, tab, Math.max(safeRows.length - 1, 0))
  await withRetry(() =>
    sheets.spreadsheets.values.update(
      {
        spreadsheetId,
        range: tabRange(),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: safeRows },
      },
      { timeout: 30_000 },
    ),
  )
}
```

- [ ] **Step 4: Pass the tab at the call site**

In `apps/api/src/invoices/sheetSync.ts`, line 99:

```ts
  await overwriteRows(spreadsheetId, [EXPORT_HEADER, ...dataRows], tab)
```

And extend the `mirrorUserSheet` doc comment (line 58-61) — replace "clear the tab, write the header + every exportable invoice row" with:

```
 * id, clear the tab, size the tab's Sheets Table to the rows about to land,
 * write the header + every exportable invoice row (ascending by invoice
 * number), re-apply the dropdown validation rules, then stamp
```

- [ ] **Step 5: Run the full api suite plus lint and typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
npm run lint && npm run typecheck
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
```

Expected: PASS. A failure in a test this plan never touched is likely the known landlord-row flake — re-run once, and report it either way.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/sheets.ts apps/api/src/invoices/sheetSync.ts \
        apps/api/test/integrations/sheets.test.ts apps/api/test/sheets.sync.test.ts
git commit -m "feat(api): mirror rows into the landlord's Sheets Table, resized to fit"
```

---

### Task 4: Record the decision

**Files:**
- Modify: `docs/DECISIONS.md` (the DEC-026 entry, line 59)
- Modify: `docs/SHEETS_EXPORT.md`
- Modify: `docs/brainstorms/2026-08-10-sheets-table-aware-mirror-requirements.md`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1-3.
- Produces: nothing code-facing.

- [ ] **Step 1: Append (g) to DEC-026**

DEC-026 is a single long bullet with lettered clauses ending at (f), the Tables-coexistence clause this work continues. Append, in the same voice and on the same bullet:

```
(g) **Table row extent** (2026-08-10): the mirror also RESIZES the tab's Sheets Table to header + N data rows on every pass, in one `updateTable` (`fields: 'range'`) issued by `resizeTableRows` between `overwriteRows`' clear and its write. Without it, values written past the table's last row land outside it — unbanded, untyped, outside the table's sort/filter — and no `values` call ever moves a table's boundary. Resize is symmetric: it SHRINKS too, because a full mirror that clears the tab each pass (DEC-001) would otherwise leave empty banded rows carrying stale typed-column validation; rows lost to a shrink stay recoverable in Google's own version history, and Postgres is the source of truth regardless. Only the table anchored at A1 is managed — the sole geometry the `A1` values write aligns with; a table at another origin, or a second table lower on the tab, resolves to `table: null` and the pass proceeds exactly as before, as does a tab with no table at all (the mirror never CREATES one — the table is the landlord's artifact). Two traps: a `GridRange` OMITS `startRowIndex`/`startColumnIndex` when they are 0 (proto3), so an ABSENT anchor is the anchored case — reading absence as a miss would disable the feature for exactly its targets (same trap as `columnIndex ?? 0` in (f)); and the row count floors at 1 because a table cannot be header-only (a landlord with zero exportable invoices would hit a Google 400). Resize precedes the write so `values.update` lands in columns that already carry their types, rather than asking Google to retro-fit a type onto text it never validated. Quota: 4 writes + 1 read per dirty user (was 3 + 1). Failure semantics unchanged — a resize failure aborts before the write, leaves the user un-stamped, and the next pass re-mirrors (DEC-024).
```

- [ ] **Step 2: Note the landlord-facing behavior in SHEETS_EXPORT.md**

Add a short subsection in the voice of the surrounding file. It must state the two things a landlord can observe:

- If the Invoices tab has a table starting at cell **A1**, every sync resizes it to fit the exported invoices, so new rows arrive already formatted — and the table shrinks when invoices are removed.
- A table that starts anywhere other than A1 is left untouched, and rows will be written outside it. That is the fix for a landlord whose formatting isn't being applied: move the table to A1.

- [ ] **Step 3: Reconcile the spec doc**

In `docs/brainstorms/2026-08-10-sheets-table-aware-mirror-requirements.md`, the "Call order" section lists `resizeTableRows` as step 3 of a five-step `mirrorUserSheet`. Rewrite that list to match what shipped — `mirrorUserSheet` calls `resolveSheetTab`, `overwriteRows(…, tab)`, `applyColumnDropdowns`, and `overwriteRows` internally does clear → resize → write — and keep the rationale paragraphs, which are unchanged. Note in one sentence that the resize lives inside `overwriteRows` so the clear/resize/write sequence stays owned by one function.

- [ ] **Step 4: Verify nothing else claims the old behavior**

```bash
grep -rn "overwriteRows\|typedColumnIndexes\|Table" docs/ | grep -v node_modules
```

Read the hits. Fix any that now describe the mirror as table-unaware. Do not rewrite unrelated history entries in DECISIONS.md — DEC-026(f) stays exactly as written; (g) continues it.

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/SHEETS_EXPORT.md \
        docs/brainstorms/2026-08-10-sheets-table-aware-mirror-requirements.md
git commit -m "docs: record DEC-026(g), the Sheets Table row-extent resize"
```

---

## Manual verification (after Task 4)

The unit tests mock `googleapis` entirely, so nothing above proves Google accepts the `updateTable` request. Before calling this done, one live check against a real sheet:

1. On the connected spreadsheet's **Invoices** tab, confirm a Table exists starting at A1 (Sheets: Format → Convert to table, if not).
2. Note the table's last row.
3. Trigger a sync (edit any invoice, then run the sync cron endpoint — see `docs/DEPLOYMENT.md` for the `CRON_SECRET`-gated invocation).
4. Confirm every mirrored row is inside the table: banding continues to the last row, and the table's boundary sits at the final invoice.
5. Delete a few invoices, sync again, confirm the table shrank rather than leaving empty banded rows.

Report the result. If Google rejects `updateTable`, capture the sanitized error code and stop — do not work around it by writing outside the table.
