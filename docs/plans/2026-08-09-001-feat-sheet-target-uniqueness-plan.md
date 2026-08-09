# Sheet Target Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for two landlord accounts to connect the same Google spreadsheet, closing a cross-tenant data-loss hole where the second account's sync silently erases the first's ledger.

**Architecture:** Three layers, each with one job. A shared normalizer turns a pasted Sheets URL or a bare id into one canonical bare id, so two spellings of one sheet cannot become two distinct rows. A unique index on `users.sheetSpreadsheetId` is the authority — no pre-flight read, because two concurrent saves would both see the id as free. `saveSheet` catches the resulting P2002 and translates it into a 409 with a message the landlord can act on.

**Tech Stack:** Zod 4 (`packages/shared`), Prisma + PostgreSQL, Fastify 5, Vitest, React 19.

**Spec:** `docs/brainstorms/2026-08-09-sheet-target-uniqueness-requirements.md`

## Global Constraints

- **Definition of Done for every task:** `npm run lint && npm run typecheck && npm run test` all green from the repo root.
- **NEVER run the api test suite bare.** The root `.env` `DATABASE_URL` points at the **production** database. Every api test command in this plan is written in full — run it exactly as written:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
- **Never run `npm run test` from the repo root** for the api workspace for the same reason. Shared and web suites are safe (`npm test -w @mac-invoices/shared`, `npm test -w @mac-invoices/web`).
- **Node 24 is required.** The shell defaults to Node 20, where every Prisma command dies with a misleading zeptomatch ESM error. Prefix any shell that runs Prisma or the test suites with:
  `export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"` — then confirm `node -v` prints `v24.12.0`.
- **Prisma must run with cwd at `apps/api`**, because `apps/api/prisma.config.ts` supplies the datasource url. `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` from the repo root fails with "The datasource.url property is required". Use the workspace scripts instead: `npm run db:deploy`, `npm run db:generate` (both delegate to `-w @mac-invoices/api`), with `DATABASE_URL` set to the local database on the same command line.
- **Local Postgres** runs on port **5433** (`docker compose up -d`); a native host Postgres shadows 5432.
- **Commits go directly on `main`.** No feature branch. Do not push — the user pushes when they ask.
- **The api suite has a known pre-existing flake** (~1 run in 3): `settings.profile.test.ts:65` mutates the shared landlord's email mid-run, so a parallel file's `loginCookie()` 401s. If a failure is in a file you did not touch and mentions a login/401, re-run once before investigating. Do not "fix" it in this plan.
- **Error code string:** `SHEET_ALREADY_CONNECTED`, status **409**, message exactly:
  `That spreadsheet is already connected to another account. Please use a different one.`
- **Never name the other account** in any error message or log line.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/lib/spreadsheetId.ts` | **Create.** Pure normalizer: any input → canonical bare id or `null`. No Zod, no I/O. |
| `packages/shared/test/spreadsheet-id.test.ts` | **Create.** Unit tests for the normalizer. |
| `packages/shared/src/index.ts` | **Modify.** Export the new lib module. |
| `packages/shared/src/schemas/settings.ts:52-56` | **Modify.** `SaveSheetSchema` applies the normalizer and rejects non-ids. |
| `packages/shared/test/settings.test.ts` | **Modify.** Schema-level tests for accept/normalize/reject. |
| `apps/api/prisma/schema.prisma:28` | **Modify.** `@unique` on `sheetSpreadsheetId`. |
| `apps/api/prisma/migrations/20260809120000_unique_sheet_target/migration.sql` | **Create.** The unique index. |
| `apps/api/src/settings/handlers.ts:139-147` | **Modify.** `saveSheet` translates P2002 → 409. |
| `apps/api/test/settings.sheets.test.ts` | **Modify.** Realistic ids; new collision tests. |
| `apps/web/src/pages/Settings.tsx:158` | **Modify.** Field label mentions URL. |
| `docs/DECISIONS.md` | **Modify.** Append DEC-033. |
| `docs/DEPLOYMENT.md` | **Modify.** Migration runbook entry with the duplicate pre-check. |

**Two spec questions resolved here:**
1. *Where does the normalizer live?* `packages/shared/src/lib/` — matching the existing `invoiceOrder.ts` / `summarizeItems.ts` pattern for pure helpers, keeping `schemas/settings.ts` about schemas.
2. *Inline P2002 catch or central `errorHandler`?* **Inline in `saveSheet`.** The central handler maps Prisma codes generically and has no idea which constraint fired; keying it on a specific constraint name would couple the middleware to one column of one table. The local catch is where the knowledge belongs.

---

### Task 1: Normalize and validate the spreadsheet id in the shared contract

Makes a pasted URL work, rejects input that could never be a sheet, and canonicalizes storage so the Task 2 index can actually do its job. Also repairs the three existing api tests that save non-id strings through the API — they break the moment this lands, so they are fixed in the same task.

**Files:**
- Create: `packages/shared/src/lib/spreadsheetId.ts`
- Create: `packages/shared/test/spreadsheet-id.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/schemas/settings.ts:52-56`
- Modify: `packages/shared/test/settings.test.ts`
- Modify: `apps/api/test/settings.sheets.test.ts:70,72,73,77,87,104`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `normalizeSpreadsheetId(input: string): string | null` — exported from `@mac-invoices/shared`. Returns the canonical bare id, or `null` when the input is not a plausible spreadsheet id or URL. `SaveSheetSchema` keeps its shape `{ spreadsheetId: string }`; its **output** is now always a bare id.

- [ ] **Step 1: Write the failing normalizer tests**

Create `packages/shared/test/spreadsheet-id.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeSpreadsheetId } from '../src/lib/spreadsheetId'

// A realistic Google Drive file id: 44 URL-safe base64 characters.
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd'

describe('normalizeSpreadsheetId', () => {
  it('returns a bare id unchanged', () => {
    expect(normalizeSpreadsheetId(ID)).toBe(ID)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSpreadsheetId(`  ${ID}\n`)).toBe(ID)
  })

  it('extracts the id from a full edit URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID)
  })

  it('extracts the id from a share URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(ID)
  })

  it('extracts the id from a URL with no scheme', () => {
    expect(normalizeSpreadsheetId(`docs.google.com/spreadsheets/d/${ID}`)).toBe(ID)
  })

  // The whole point of normalizing: these two inputs must collapse to one
  // value, or the unique index compares two strings and lets both through.
  it('collapses the URL and bare forms of one sheet to the same value', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe(
      normalizeSpreadsheetId(ID),
    )
  })

  it('rejects free text', () => {
    expect(normalizeSpreadsheetId('my sheet')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(normalizeSpreadsheetId('')).toBeNull()
    expect(normalizeSpreadsheetId('   ')).toBeNull()
  })

  it('rejects something too short to be a Drive id', () => {
    expect(normalizeSpreadsheetId('abc')).toBeNull()
  })

  it('rejects an id containing characters Drive ids never use', () => {
    expect(normalizeSpreadsheetId(`${ID}!`)).toBeNull()
  })

  // A Docs/Slides URL has no /spreadsheets/d/ segment, so it falls through to
  // the bare-id rule and fails it (slashes are not valid id characters).
  it('rejects a Google Docs URL', () => {
    expect(normalizeSpreadsheetId(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull()
  })

  it('rejects a spreadsheets URL whose id segment is too short', () => {
    expect(normalizeSpreadsheetId('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mac-invoices/shared -- spreadsheet-id`
Expected: FAIL — cannot resolve `../src/lib/spreadsheetId`.

- [ ] **Step 3: Write the normalizer**

Create `packages/shared/src/lib/spreadsheetId.ts`:

```ts
// Canonicalizing what a landlord pastes into the Sheets connection field.
//
// This is not a convenience. `users.sheetSpreadsheetId` carries a UNIQUE index
// so two accounts cannot target one spreadsheet (the mirror is
// clear-and-rewrite — DEC-001 — so a shared target means the second sync
// erases the first's ledger). A unique index compares strings, so
// `https://docs.google.com/spreadsheets/d/<id>/edit` and `<id>` would be two
// distinct values naming one sheet and slip straight past it. Pasting the URL
// is the more natural action of the two, so this is the likely path, not the
// exotic one.

/**
 * Drive file ids are URL-safe base64-ish: letters, digits, `-`, `_`. Current
 * ids are 44 characters; older ones are shorter, so the floor is deliberately
 * loose rather than pinned to today's length — rejecting a legitimate id is
 * worse than accepting a string that later fails the reachability check.
 */
const BARE_ID = /^[A-Za-z0-9_-]{20,200}$/

/**
 * Every Sheets URL carries the id in a `/spreadsheets/d/<id>` path segment,
 * whatever follows it (`/edit`, `#gid=0`, `?usp=sharing`, nothing at all).
 */
const URL_ID = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/

/**
 * The canonical bare id for `input`, or `null` if it is not a plausible
 * spreadsheet id or Sheets URL. A Docs/Slides URL has no `/spreadsheets/d/`
 * segment, so it falls through to the bare-id rule and fails it — which is
 * correct, it is not a spreadsheet.
 */
export function normalizeSpreadsheetId(input: string): string | null {
  const trimmed = input.trim()
  const candidate = URL_ID.exec(trimmed)?.[1] ?? trimmed
  return BARE_ID.test(candidate) ? candidate : null
}
```

- [ ] **Step 4: Export it from the shared package**

In `packages/shared/src/index.ts`, add alongside the other `./lib/` exports:

```ts
export * from './lib/spreadsheetId'
```

- [ ] **Step 5: Run the normalizer tests to verify they pass**

Run: `npm test -w @mac-invoices/shared -- spreadsheet-id`
Expected: PASS, 12 tests.

- [ ] **Step 6: Write the failing schema tests**

Append to `packages/shared/test/settings.test.ts`:

```ts
import { SaveSheetSchema } from '../src/schemas/settings'

describe('SaveSheetSchema', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd'

  it('accepts a bare spreadsheet id', () => {
    expect(SaveSheetSchema.parse({ spreadsheetId: ID }).spreadsheetId).toBe(ID)
  })

  it('stores the bare id when given a full URL', () => {
    const parsed = SaveSheetSchema.parse({
      spreadsheetId: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
    })
    expect(parsed.spreadsheetId).toBe(ID)
  })

  it('rejects input that is not an id or a URL', () => {
    const result = SaveSheetSchema.safeParse({ spreadsheetId: 'my sheet' })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].message).toMatch(/Google Sheets ID or URL/)
  })

  it('rejects an empty value', () => {
    expect(SaveSheetSchema.safeParse({ spreadsheetId: '' }).success).toBe(false)
  })

  it('accepts a URL long enough that the old 200-char cap would have rejected it', () => {
    const long = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing&${'x'.repeat(180)}`
    expect(SaveSheetSchema.parse({ spreadsheetId: long }).spreadsheetId).toBe(ID)
  })
})
```

If `settings.test.ts` already imports from `../src/schemas/settings`, merge the import rather than adding a second one. Keep the existing `describe` blocks untouched.

- [ ] **Step 7: Run the schema tests to verify they fail**

Run: `npm test -w @mac-invoices/shared -- settings`
Expected: FAIL — a bare URL currently parses through unchanged, and `'my sheet'` currently succeeds.

- [ ] **Step 8: Rewrite SaveSheetSchema**

In `packages/shared/src/schemas/settings.ts`, add to the imports at the top:

```ts
import { normalizeSpreadsheetId } from '../lib/spreadsheetId'
```

Replace lines 52-56 (`// Save a per-landlord Google Sheets target.` through `export type SaveSheetInput = ...`) with:

```ts
// Save a per-landlord Google Sheets target. Accepts a bare id or a pasted
// Sheets URL and ALWAYS stores the bare id — normalizing here is what makes
// the UNIQUE index on `users.sheetSpreadsheetId` mean "one sheet per account"
// (two spellings of one sheet would otherwise be two distinct strings and slip
// past it). The cap is 500, not 200: a full share URL is longer than an id.
export const SaveSheetSchema = z.object({
  spreadsheetId: z
    .string()
    .max(500)
    .transform((value, ctx) => {
      const id = normalizeSpreadsheetId(value)
      if (id === null) {
        ctx.addIssue({
          code: 'custom',
          message: "That doesn't look like a Google Sheets ID or URL",
        })
        return z.NEVER
      }
      return id
    }),
})
export type SaveSheetInput = z.infer<typeof SaveSheetSchema>
```

- [ ] **Step 9: Run the shared suite to verify it passes**

Run: `npm test -w @mac-invoices/shared`
Expected: PASS, all files.

- [ ] **Step 10: Repair the three api tests that save non-id strings**

`apps/api/test/settings.sheets.test.ts` saves `SHEET-ABC`, `UNREACHABLE`, and `SAVED-TARGET` **through the API**; all three are now 400s. They must become realistic ids. (The values in `invoices.export.test.ts` and `sheets.sync.test.ts` are written directly through Prisma, bypassing the schema — leave those alone.)

Add near the top of `apps/api/test/settings.sheets.test.ts`, after the imports:

```ts
// Realistic Drive file ids — SaveSheetSchema rejects anything that isn't one,
// and each is distinct because users.sheetSpreadsheetId is UNIQUE.
const ID_SAVED = '1SettingsSheetsSavedAAAAAAAAAAAAAAAAAAAAAAAA'
const ID_UNREACHABLE = '1SettingsSheetsUnreachableBBBBBBBBBBBBBBBBBB'
const ID_TARGET = '1SettingsSheetsSyncNowCCCCCCCCCCCCCCCCCCCCCC'
```

Then replace the three usages:

```ts
  it('saves a target spreadsheet id and reflects it in status', async () => {
    const res = await save(ID_SAVED)
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe(ID_SAVED)
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).sheetSpreadsheetId).toBe(ID_SAVED)
  })
```

```ts
    await save(ID_UNREACHABLE)
```

```ts
    await save(ID_TARGET)
```

and the assertion that pairs with the last one:

```ts
    expect(sheets.overwriteRows.mock.calls[0][0]).toBe(ID_TARGET) // targeted the saved id
```

- [ ] **Step 11: Run the api settings tests**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets`
Expected: PASS, all 5 existing tests.

- [ ] **Step 12: Run lint, typecheck, and the full suites**

Run: `npm run lint && npm run typecheck`
Run: `npm test -w @mac-invoices/shared && npm test -w @mac-invoices/web`
Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add packages/shared/src/lib/spreadsheetId.ts packages/shared/test/spreadsheet-id.test.ts \
  packages/shared/src/index.ts packages/shared/src/schemas/settings.ts \
  packages/shared/test/settings.test.ts apps/api/test/settings.sheets.test.ts
git commit -m "feat(shared): normalize the Sheets target to a canonical id

A pasted share URL and the bare id it contains name one spreadsheet. Storing
them verbatim would give the UNIQUE index landing next two distinct strings for
one sheet, so the constraint would pass and the clear-and-rewrite mirror would
still let one tenant erase another's ledger.

Also rejects input that could never be a spreadsheet, instead of saving a
target that can only ever fail the reachability check."
```

---

### Task 2: Make the database enforce one spreadsheet per account

**Files:**
- Modify: `apps/api/prisma/schema.prisma:26-28`
- Create: `apps/api/prisma/migrations/20260809120000_unique_sheet_target/migration.sql`
- Modify: `apps/api/test/settings.sheets.test.ts`

**Interfaces:**
- Consumes: `normalizeSpreadsheetId` from Task 1 (indirectly — the schema already stores canonical ids by now).
- Produces: unique index `users_sheetSpreadsheetId_key`. A duplicate write raises Prisma `P2002`, which Task 3 translates.

- [ ] **Step 1: Confirm the local database has no duplicates**

A unique index cannot be built over existing duplicates; the migration would fail halfway.

Run:
```bash
docker compose up -d
psql "postgresql://postgres:postgres@localhost:5433/invoices" -c \
  'SELECT "sheetSpreadsheetId", count(*) FROM users WHERE "sheetSpreadsheetId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;'
```
Expected: `(0 rows)`. If any row comes back, stop and report it — do not clear the data yourself.

- [ ] **Step 2: Write the failing test**

Add to `apps/api/test/settings.sheets.test.ts`, inside the `describe('Sheets settings')` block:

```ts
  it('the database refuses two accounts pointing at one spreadsheet', async () => {
    // Direct Prisma writes, deliberately bypassing the API: this asserts the
    // INDEX exists, not the handler's error translation (that is a separate
    // test). Without the index this write simply succeeds.
    const shared = '1DbLevelUniquenessDDDDDDDDDDDDDDDDDDDDDDDDD'
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: u.user.id },
        data: { sheetSpreadsheetId: shared },
      })
      await expect(
        app.prisma.user.update({
          where: { id: other.user.id },
          data: { sheetSpreadsheetId: shared },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    } finally {
      await app.prisma.user.update({
        where: { id: u.user.id },
        data: { sheetSpreadsheetId: null },
      })
      await other.cleanup()
    }
  })

  it('allows any number of accounts with no connected sheet (AE6)', async () => {
    // NULL is distinct from NULL in a Postgres unique index. Without this the
    // constraint would let exactly one landlord be unconnected, which would
    // break signup outright — worth pinning rather than trusting.
    const a = await createSecondUser(app)
    const b = await createSecondUser(app)
    try {
      const both = await app.prisma.user.findMany({
        where: { id: { in: [a.user.id, b.user.id] } },
        select: { sheetSpreadsheetId: true },
      })
      expect(both).toHaveLength(2)
      expect(both.every((x) => x.sheetSpreadsheetId === null)).toBe(true)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets`
Expected: the uniqueness test FAILS — the second update succeeds, so `.rejects` is unsatisfied. The AE6 test passes both before and after the index; it is a regression guard against someone "fixing" the constraint into a form that treats NULLs as equal, not a red-to-green step.

- [ ] **Step 4: Add the constraint to the Prisma schema**

In `apps/api/prisma/schema.prisma`, replace the `sheetSpreadsheetId` field and its comment (lines 26-28) with:

```prisma
  // Per-user Google Sheets export target — the only source for both the manual
  // "Sync now" export and continuous sync (the cron mirror). Null = no sheet
  // connected; there is no server-side fallback (removed — see DEC-029(i)).
  //
  // UNIQUE: two accounts must never target one spreadsheet. The mirror is
  // clear-and-rewrite (DEC-001), so a shared target means the second sync
  // silently erases the first's ledger. Ownership can't be verified — the
  // service account holds Editor on every connected sheet by design — so this
  // constraint is the whole defense, not defense in depth (DEC-033). NULLs are
  // distinct in Postgres, so any number of unconnected users is fine.
  sheetSpreadsheetId String?   @unique
```

- [ ] **Step 5: Write the migration**

Create `apps/api/prisma/migrations/20260809120000_unique_sheet_target/migration.sql`:

```sql
-- One spreadsheet per account.
--
-- The Sheets mirror is clear-and-rewrite (DEC-001): it wipes the tab and
-- rewrites it from one user's invoices. Two accounts sharing a target
-- therefore means whichever syncs second erases the other's ledger — with no
-- error, because from the job's perspective both mirrors succeeded.
--
-- Ownership cannot be verified from Google's side: the integration works by
-- the landlord sharing their sheet with the service account as an Editor, so
-- the service account has write access to every connected sheet by design.
-- This index is the entire defense (DEC-033).
--
-- NULL is distinct from NULL in a Postgres unique index, so any number of
-- users with no connected sheet is fine.
--
-- PRE-CHECK (must return 0 rows before running this against any environment):
--   SELECT "sheetSpreadsheetId", count(*) FROM users
--    WHERE "sheetSpreadsheetId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX "users_sheetSpreadsheetId_key" ON "users"("sheetSpreadsheetId");
```

- [ ] **Step 6: Apply the migration locally and regenerate the client**

Run from the repo root:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"   # node -v must print v24.12.0
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" npm run db:deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" npm run db:generate
```
Expected: `20260809120000_unique_sheet_target` applies; the client regenerates without error.

Do **not** use `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` — Prisma needs cwd at `apps/api` to pick up `prisma.config.ts`, which supplies the datasource url, and fails from the repo root.

- [ ] **Step 7: Verify the index exists**

Run:
```bash
psql "postgresql://postgres:postgres@localhost:5433/invoices" -c \
  "SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_sheetSpreadsheetId_key';"
```
Expected: one row, `CREATE UNIQUE INDEX ... ON public.users USING btree ("sheetSpreadsheetId")`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets`
Expected: PASS.

- [ ] **Step 9: Run the full api suite**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
Expected: all green. Pay particular attention to `sheets.sync.test.ts` and `invoices.export.test.ts` — they write targets directly and are the files a unique index could plausibly disturb. They use distinct values, so they should pass; if one fails on P2002, the fixture values collide and need a unique suffix, not a relaxed constraint.

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260809120000_unique_sheet_target \
  apps/api/test/settings.sheets.test.ts
git commit -m "feat(api): unique index on users.sheetSpreadsheetId

Two accounts could target one spreadsheet. Because the mirror is
clear-and-rewrite, the second account's sync silently erased the first's
ledger — no error, since from the job's perspective both mirrors succeeded.

The index is the authority rather than a handler check: a read-then-write
would let two concurrent saves both see the id as free."
```

---

### Task 3: Turn the constraint violation into an answer the landlord can act on

**Files:**
- Modify: `apps/api/src/settings/handlers.ts:139-147`
- Modify: `apps/api/test/settings.sheets.test.ts`

**Interfaces:**
- Consumes: the `users_sheetSpreadsheetId_key` index from Task 2 (raises `P2002`); `normalizeSpreadsheetId` from Task 1 (why the URL form collides with the bare form).
- Produces: `PATCH /api/settings/sheets` → `409 { error: { code: 'SHEET_ALREADY_CONNECTED', message: ... } }` on collision.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/settings.sheets.test.ts`, inside the `describe('Sheets settings')` block:

```ts
  it('refuses a spreadsheet another account has already connected (AE1)', async () => {
    const taken = '1AlreadyConnectedElsewhereEEEEEEEEEEEEEEEEE'
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: other.user.id },
        data: { sheetSpreadsheetId: taken },
      })
      const res = await save(taken)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('SHEET_ALREADY_CONNECTED')
      expect(res.json().error.message).toMatch(/already connected to another account/)
      // The other account's identity must never leak in the message.
      expect(res.json().error.message).not.toMatch(other.user.email)
      // And our own target is untouched by the failed save.
      const me = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
      expect(me.sheetSpreadsheetId).not.toBe(taken)
    } finally {
      await other.cleanup()
    }
  })

  it('refuses the URL form of a spreadsheet another account holds as a bare id (AE2)', async () => {
    // The reason normalization exists: without it these are two different
    // strings, the unique index sees no conflict, and the wipe still happens.
    const taken = '1UrlFormCollidesFFFFFFFFFFFFFFFFFFFFFFFFFFF'
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: other.user.id },
        data: { sheetSpreadsheetId: taken },
      })
      const res = await save(`https://docs.google.com/spreadsheets/d/${taken}/edit#gid=0`)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('SHEET_ALREADY_CONNECTED')
    } finally {
      await other.cleanup()
    }
  })

  it('lets a landlord re-save their own current spreadsheet (AE4)', async () => {
    const mine = '1MyOwnSheetReSavedGGGGGGGGGGGGGGGGGGGGGGGGG'
    expect((await save(mine)).statusCode).toBe(200)
    // Same row, same value — not a collision.
    const res = await save(mine)
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe(mine)
  })

  it('rejects input that is not a spreadsheet id or URL (AE5)', async () => {
    const before = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } }))
      .sheetSpreadsheetId
    const res = await save('my sheet')
    expect(res.statusCode).toBe(400)
    const after = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } }))
      .sheetSpreadsheetId
    expect(after).toBe(before) // nothing stored
  })

  it('frees the spreadsheet when the holding account is deleted (AE8)', async () => {
    const contested = '1FreedOnDeleteHHHHHHHHHHHHHHHHHHHHHHHHHHHH'
    const other = await createSecondUser(app)
    await app.prisma.user.update({
      where: { id: other.user.id },
      data: { sheetSpreadsheetId: contested },
    })
    expect((await save(contested)).statusCode).toBe(409)
    await other.cleanup()
    expect((await save(contested)).statusCode).toBe(200)
  })
```

Note: these tests mutate `u`'s saved target, and the existing `"Sync now"` test asserts on its own saved id. Vitest runs tests within a file sequentially, and each of these saves explicitly before asserting, so ordering is safe — but if you reorder tests, keep every assertion preceded by its own `save()`.

- [ ] **Step 2: Run them to verify they fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets`
Expected: the two collision tests and the deletion test FAIL — but **not** on the status. The raw P2002 already falls through to the central `errorHandler`, which returns 409 with code `CONFLICT` and the generic message "A record with this value already exists". So the failing assertions are the `error.code` and `error.message` ones, and the deletion test's first `expect(...409)` will already pass. That is exactly why the local translation is needed: the status was right by accident, the message told the landlord nothing. The AE4 and AE5 tests should already pass.

- [ ] **Step 3: Translate P2002 in the handler**

In `apps/api/src/settings/handlers.ts`, replace `saveSheet` (lines 139-147) with:

```ts
/**
 * PATCH /api/settings/sheets — save the per-landlord target spreadsheet id.
 *
 * The UNIQUE index on `users.sheetSpreadsheetId` is the authority, and this
 * catch is only its translator. Deliberately NOT a read-then-write "is it
 * taken?" check: two concurrent saves would both read the id as free and both
 * proceed, which is exactly the collision the constraint exists to prevent.
 * The message never names the other account (DEC-033).
 */
export async function saveSheet(request: FastifyRequest, reply: FastifyReply) {
  const { spreadsheetId } = parseBody(SaveSheetSchema, request.body)
  try {
    await request.server.prisma.user.update({
      where: { id: request.user.id },
      data: { sheetSpreadsheetId: spreadsheetId },
    })
  } catch (err) {
    // `sheetSpreadsheetId` is the only unique column this update touches, so a
    // P2002 here can only mean another account already holds this spreadsheet.
    if ((err as { code?: unknown })?.code === 'P2002') {
      throw new AppError(
        'SHEET_ALREADY_CONNECTED',
        'That spreadsheet is already connected to another account. Please use a different one.',
        409,
      )
    }
    throw err
  }
  return getSheets(request, reply)
}
```

`AppError` is already imported at the top of the file — do not add a second import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- settings.sheets`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run lint, typecheck, and the full api suite**

Run: `npm run lint && npm run typecheck`
Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/settings/handlers.ts apps/api/test/settings.sheets.test.ts
git commit -m "feat(api): 409 SHEET_ALREADY_CONNECTED on a contested spreadsheet

Translates the unique-index violation into a message the landlord can act on,
without naming the other account. No pre-flight read: the constraint is the
authority, and a read-then-write would reintroduce the race it closes."
```

---

### Task 4: Tell landlords a URL works, and record the decision

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx:158`
- Modify: `apps/web/test/Settings.test.tsx` (or the nearest existing Settings test file — check with `ls apps/web/test`)
- Modify: `docs/DECISIONS.md`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: the 409 from Task 3 (already rendered by the existing `errOf(save.error)` path — no new frontend plumbing).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing label test**

`apps/web/test/Settings.test.tsx` already exists and renders with a bare `render(<Settings />)` inside `describe('Settings page')` — there is no render helper. Add this test inside that describe block, at the end:

```tsx
  it('tells landlords the Sheets field accepts a URL as well as an id', async () => {
    render(<Settings />)
    // Pasting the share URL is the natural action; the label should not imply
    // only a bare id works.
    expect(await screen.findByLabelText('Target spreadsheet ID or URL')).toBeTruthy()
  })
```

If the existing tests in the file need the Sheets section to have loaded (it renders `Loading…` while `isPending`), follow whatever the neighbouring tests already do to await it — do not invent new mocking.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @mac-invoices/web -- Settings`
Expected: FAIL — the label is currently `Target spreadsheet ID`.

- [ ] **Step 3: Update the label**

In `apps/web/src/pages/Settings.tsx` line 158, change:

```tsx
            <label htmlFor="sheetId" className="text-sm font-medium text-foreground">Target spreadsheet ID</label>
```

to:

```tsx
            <label htmlFor="sheetId" className="text-sm font-medium text-foreground">Target spreadsheet ID or URL</label>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @mac-invoices/web -- Settings`
Expected: PASS.

- [ ] **Step 5: Record DEC-033**

Append to `docs/DECISIONS.md`, matching the existing bullet format (`- **DEC-0NN — Title** (plan: ..., spec: ...). (a) ... (b) ...`):

```markdown
- **DEC-033 — One spreadsheet per account, enforced by a unique index; the Sheets target is normalized to a bare id** (plan: `docs/plans/2026-08-09-001-feat-sheet-target-uniqueness-plan.md`, spec: `docs/brainstorms/2026-08-09-sheet-target-uniqueness-requirements.md`). (a) **`users.sheetSpreadsheetId` is UNIQUE.** Two accounts could previously connect the same spreadsheet, and because `mirrorUserSheet` is clear-and-rewrite (DEC-001), whichever synced second silently erased the other's ledger — with no error, since from the cron's perspective both mirrors succeeded. This became reachable in production with invite-gated signup (DEC-029). (b) **Ownership cannot be verified, which is why the constraint is load-bearing rather than defense in depth.** The integration works by the landlord sharing their sheet with the service account as an Editor, so the service account holds write access to every connected sheet by design; `checkAccess` will confirm reachability of a spreadsheet belonging to someone else because it genuinely is reachable. Google cannot tell us who should own it. If per-user OAuth ever replaces the shared service account, this reasoning changes and should be revisited. (c) **No pre-flight "is it taken?" read.** The index is the authority and `saveSheet` only translates the P2002 into `409 SHEET_ALREADY_CONNECTED`. A read-then-write would let two concurrent saves both see the id as free — precisely the collision being closed. Rejected for the same reason: doing both, since the pre-check earns nothing once the constraint yields the same message. (d) **NULLs are distinct in a Postgres unique index**, so any number of unconnected landlords is fine and no partial `WHERE ... IS NOT NULL` index is needed. (e) **The saved value is normalized to a bare id** (`packages/shared/src/lib/spreadsheetId.ts`), because a unique index compares strings: a pasted `https://docs.google.com/spreadsheets/d/<id>/edit` and a typed `<id>` would otherwise be two distinct values naming one sheet and slip straight past the constraint. Pasting the URL is the more natural action, so this is the likely path, not the exotic one. Input that is not a plausible id or Sheets URL is now a 400 rather than a silently-saved target that can never work. (f) **The collision message says "already connected to another account" and never names the other account.** Accepted: someone probing ids learns whether a given sheet is connected — which requires already knowing the id and grants no access. Rejected: a vague "can't be connected" (unactionable for a landlord fixing their own mistake), and naming the holding account's email (exposes one tenant's identity to another). (g) **Not addressed:** a transfer/force-claim flow (deleting the holding account already frees the id), and two spreadsheets sharing data by other means such as `IMPORTRANGE` (out of reach).
```

- [ ] **Step 6: Add the migration runbook entry**

In `docs/DEPLOYMENT.md`, add a subsection under §3 following the existing `### Contractor → Vendor rename (2026-08-07)` pattern:

```markdown
### Unique Sheets target (2026-08-09)

`20260809120000_unique_sheet_target` adds `UNIQUE (users."sheetSpreadsheetId")`.

**Pre-check — must return 0 rows, or the migration fails halfway:**

```sql
SELECT "sheetSpreadsheetId", count(*)
  FROM users
 WHERE "sheetSpreadsheetId" IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;
```

If it returns rows, two accounts are already sharing a spreadsheet and one of
them has been having its ledger overwritten. Resolve by hand — decide which
account keeps the sheet and null the other's target — before migrating. Do not
work around the constraint.

The index builds instantly at current scale (a single-digit number of
connected users), so a plain `CREATE UNIQUE INDEX` inside the migration
transaction is correct; `CONCURRENTLY` is not needed and would prevent the
migration from being transactional.

**Rollback:** `DROP INDEX "users_sheetSpreadsheetId_key";` then
`prisma migrate resolve --rolled-back 20260809120000_unique_sheet_target`.
Dropping it reopens the cross-tenant wipe, so treat rollback as a last resort.
```

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run typecheck && npm run format:check`
Run: `npm test -w @mac-invoices/shared && npm test -w @mac-invoices/web`
Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
Expected: all green. If `format:check` flags files this plan touched, run `npm run format` scoped to those files and re-check.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Settings.tsx apps/web/test docs/DECISIONS.md docs/DEPLOYMENT.md
git commit -m "feat(web): label the Sheets field as id-or-URL; document DEC-033

Pasting a share URL now works, so the label should say so. DEC-033 records why
the unique index is the whole defense rather than defense in depth: ownership
cannot be verified while a shared service account holds Editor on every
connected sheet."
```

---

## Post-Implementation: Production Migration

Do **not** run this without the user's explicit go-ahead — it touches the production database.

1. Run the §3 pre-check above against production. Expect 0 rows (one user currently has a non-null target).
2. Fingerprint the landlord's invoices before and after, as in the DEC-030 migration, and confirm the two match.
3. `prisma migrate deploy` against the direct (non-pooled) URL.
4. Verify: `SELECT indexdef FROM pg_indexes WHERE indexname = 'users_sheetSpreadsheetId_key';` returns one row.
5. Smoke test: `GET /api/health` → 200, and the landlord's Settings page still shows their sheet as Connected.
