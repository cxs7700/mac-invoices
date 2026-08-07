# Per-Tenant Invoice Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoice numbers unique and sequential per landlord instead of globally, closing the two cross-tenant defects recorded in DEC-029(j).

**Architecture:** `Invoice.invoiceNumber` loses its global `@unique` and the model gains `@@unique([userId, invoiceNumber])`, applied by a hand-authored non-destructive migration that rewrites no rows. `nextInvoiceNumber()` gains a `userId` parameter and scopes its scan to that owner. Both changes are needed: scoping the scan alone would leave the cross-tenant 409 existence oracle in place.

**Tech Stack:** Prisma (PostgreSQL), Fastify 5, Vitest.

**Spec:** `docs/brainstorms/2026-08-07-per-tenant-invoice-numbering-requirements.md`

## Global Constraints

- **⚠️ Always run the api suite against the LOCAL database.** The root `.env` `DATABASE_URL` points at the **hosted/production** database. Use this exact invocation every time:

  ```bash
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" \
  LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
  ```

  The same override applies to every `prisma` command in this plan. Port **5433** because a native host Postgres shadows 5432. `dotenv` does not override variables already present in the environment, so the shell values win.

- **Known pre-existing flake:** the api suite fails roughly 1 run in 3 from a cross-file race — `apps/api/test/settings.profile.test.ts` mutates the shared seeded landlord's email mid-run, so a concurrent file's `loginCookie()` can fail with `login failed (401); reseed with LANDLORD_PASSWORD set`. **This predates this work. Do not "fix" it.** If you hit it, re-run; use `--no-file-parallelism` for a deterministic signal. Never let it mask a real failure of your own — confirm any failure is that race before dismissing it.

- **No invoice number may be rewritten** (spec R5). The migration is a constraint change only. Do not write a backfill.

- **Migrate before deploying the code** — the usual `docs/DEPLOYMENT.md` §3 rule applies to this migration (unlike the previous `drop_invoice_description` migration, which inverted it).

- **Multiple NULL `invoiceNumber` rows per user must keep working** (spec R4) — contractor submissions are unnumbered until approved. Postgres treats NULLs as never-equal, so a composite unique permits this; do not add a partial index or `NULLS NOT DISTINCT`.

- **Use `prisma migrate deploy`, never `prisma migrate dev`** — the latter spins up a Prisma Dev server that is unreliable in this project. Migrations here are hand-authored.

- **Use Node 24 for Prisma commands** (`.nvmrc` = v24.12.0). On older Node, Prisma crashes inside `@prisma/dev` with `ERR_REQUIRE_ESM`. If needed: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24`.

- **Out of scope:** invoice-number format changes, prefixes, renumbering, password reset, email verification, Google OAuth, and the api-suite flake.

---

### Task 1: Composite unique constraint (schema + migration + seed)

These three land together because they are inseparable: dropping the global `@unique` removes `invoiceNumber` from Prisma's generated unique-where type, which immediately breaks `prisma/seed.ts`'s `upsert`. A commit containing only the schema change would not typecheck.

**Files:**
- Modify: `apps/api/prisma/schema.prisma:86` (drop `@unique`) and the `Invoice` model's attribute block near `:122-126` (add `@@unique`)
- Create: `apps/api/prisma/migrations/20260807120000_per_tenant_invoice_numbering/migration.sql`
- Modify: `apps/api/prisma/seed.ts:117`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a composite unique on `invoices(userId, invoiceNumber)`, and the Prisma unique-where selector `userId_invoiceNumber: { userId, invoiceNumber }` that Task 2's tests and the seed both use. The global `invoiceNumber` unique selector no longer exists.

- [ ] **Step 1: Confirm the existing index name before writing SQL**

The migration must drop the index by its real name. Prisma's convention gives `invoices_invoiceNumber_key`, but verify rather than assume:

```bash
docker exec mac-invoices-db psql -U postgres -d invoices -c \
  "SELECT indexname FROM pg_indexes WHERE tablename = 'invoices';"
```

Expected: a row named `invoices_invoiceNumber_key`. If it differs, use the real name in Step 3 and note the discrepancy in your report.

- [ ] **Step 2: Update the Prisma schema**

In `apps/api/prisma/schema.prisma`, change line 86 from:

```prisma
  invoiceNumber          String?          @unique
```

to:

```prisma
  // Sequential per OWNER, not globally: see @@unique([userId, invoiceNumber])
  // below. Nullable because a contractor submission carries no number until it
  // is approved (KTD-11); Postgres treats NULLs as never-equal, so a user may
  // hold many unnumbered invoices at once.
  invoiceNumber          String?
```

Then, in the same `Invoice` model's attribute block (alongside the existing `@@index` lines, before `@@map("invoices")`), add:

```prisma
  // Per-tenant numbering: two landlords may each hold invoice "1". A global
  // unique here would leak across tenants — a collision with ANOTHER user's
  // number returned 409, which is a working existence oracle (DEC-029(j)).
  @@unique([userId, invoiceNumber])
```

- [ ] **Step 3: Hand-author the migration**

Create `apps/api/prisma/migrations/20260807120000_per_tenant_invoice_numbering/migration.sql`:

```sql
-- Per-tenant invoice numbering. Replaces the GLOBAL unique on
-- invoices."invoiceNumber" with a per-owner composite unique.
--
-- Why: before this, a new tenant's first auto-assigned number was
-- (global max + 1), silently reporting the incumbent landlord's invoice count;
-- and a client-supplied number colliding with ANOTHER tenant's invoice returned
-- 409, which is a working cross-tenant existence oracle. See DEC-029(j) and
-- docs/brainstorms/2026-08-07-per-tenant-invoice-numbering-requirements.md.
--
-- NON-DESTRUCTIVE: no row is read or modified. Every existing invoiceNumber is
-- already globally unique, so existing data satisfies the composite constraint
-- with no cleanup or backfill.
--
-- DEPLOY ORDER: migrate FIRST, then deploy the scoped-scan code (the usual
-- docs/DEPLOYMENT.md §3 rule -- unlike drop_invoice_description, which inverted
-- it). In the window between the two, the still-running old code's global scan
-- yields a number that satisfies the composite constraint, and same-tenant
-- duplicates still conflict. The only behavior this migration alone unlocks is
-- cross-tenant number reuse, which is the intended end state.
--
-- NULLs: Postgres treats NULLs as never equal, so many unnumbered invoices per
-- user remain allowed -- contractor submissions are unnumbered until approved.

-- DropIndex
DROP INDEX "invoices_invoiceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_userId_invoiceNumber_key" ON "invoices"("userId", "invoiceNumber");
```

If Step 1 reported a different index name, substitute it in the `DROP INDEX` line.

- [ ] **Step 4: Apply the migration locally and regenerate the client**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" \
  npx prisma generate --schema apps/api/prisma/schema.prisma
```

Expected: the migration applies cleanly with no data warnings.

- [ ] **Step 5: Verify the constraint actually changed in the database**

```bash
docker exec mac-invoices-db psql -U postgres -d invoices -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'invoices' AND indexdef LIKE '%UNIQUE%';"
```

Expected: `invoices_userId_invoiceNumber_key` over `("userId", "invoiceNumber")` is present, and `invoices_invoiceNumber_key` is **gone**.

- [ ] **Step 6: Fix the seed's unique selector**

`apps/api/prisma/seed.ts:117` currently reads `where: { invoiceNumber: data.invoiceNumber }`. That selector no longer exists. Change the upsert to:

```ts
    await prisma.invoice.upsert({
      // invoiceNumber is unique per OWNER now, not globally, so the selector is
      // the composite key. The seed only ever writes the landlord's invoices.
      where: {
        userId_invoiceNumber: { userId: LANDLORD_ID, invoiceNumber: data.invoiceNumber },
      },
      update: {},
      create: data,
    })
```

- [ ] **Step 7: Verify typecheck and the seed's idempotence**

```bash
npm run typecheck
```
Expected: clean. If `seed.ts` still errors on the unique selector, the composite key name is wrong — check the generated client for the exact `userId_invoiceNumber` spelling.

Then confirm the seed is still idempotent (spec R8) by running it twice and checking the invoice count is unchanged:

```bash
docker exec mac-invoices-db psql -U postgres -d invoices -t -c "SELECT COUNT(*) FROM invoices;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm run db:seed -w @mac-invoices/api
docker exec mac-invoices-db psql -U postgres -d invoices -t -c "SELECT COUNT(*) FROM invoices;"
```
Expected: the two counts are identical.

- [ ] **Step 8: Run the full api suite**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
```
Expected: PASS. No test should need editing — this task changes the constraint, not the numbering behavior, so existing single-tenant expectations still hold. If a test fails, check it is not the known flake before investigating.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts
git commit -m "feat(api): per-tenant unique on (userId, invoiceNumber)

Replaces the global unique on invoiceNumber. Non-destructive: existing
numbers are already globally unique, so they satisfy the composite
constraint with no backfill.

Dropping the global unique also removes invoiceNumber as a Prisma unique
selector, so the seed's upsert moves to the composite key."
```

---

### Task 2: Scope the next-number scan to the owner

**Files:**
- Modify: `apps/api/src/invoices/writeService.ts:171` (`nextInvoiceNumber`), `:248` (create call site), `:485` (APPROVED call site)
- Test: `apps/api/test/invoices.numbering.test.ts` (new)

**Interfaces:**
- Consumes: the composite unique from Task 1, and its `userId_invoiceNumber` selector.
- Produces: `nextInvoiceNumber(tx: Prisma.TransactionClient, userId: string): Promise<string>` — returns the owner's highest parsed number plus one, as a string; `"1"` when the owner has no numbered invoices.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/invoices.numbering.test.ts`:

**Why two throwaway tenants and not the seeded landlord:** eight other test files log in as the seeded landlord and create invoices, and vitest runs test files in parallel. Any assertion of the form "the landlord's next number is their current max + 1" races with all of them and would be flaky by construction — and, worse, would look exactly like the known pre-existing flake and get dismissed. Both tenants here are created by this file, so nothing else can touch their sequences.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()

// Two throwaway tenants owned entirely by this file. `createSecondUser`
// randomizes the email, so calling it twice yields two independent landlords.
let a: Awaited<ReturnType<typeof createSecondUser>>
let b: Awaited<ReturnType<typeof createSecondUser>>

const body = (over: Record<string, unknown> = {}) => ({
  vendorName: 'Vendor',
  items: [{ description: 'Work', quantity: 1, total: 100 }],
  category: 'OTHER',
  invoiceDate: '2026-02-01',
  ...over,
})

async function create(cookie: string, over: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/api/invoices', payload: body(over), headers: { cookie } })
}

/** Give a tenant pre-existing numbered invoices without going through the API. */
async function seedNumbers(userId: string, numbers: string[]) {
  for (const invoiceNumber of numbers) {
    await app.prisma.invoice.create({
      data: {
        invoiceNumber,
        vendorName: 'Seeded',
        amount: 100,
        invoiceDate: new Date('2026-02-01'),
        userId,
      },
    })
  }
}

beforeAll(async () => {
  await app.ready()
  a = await createSecondUser(app)
  b = await createSecondUser(app)
})

afterAll(async () => {
  // cleanup() deletes the tenant's invoices before the user, which matters:
  // Invoice.propertyId is onDelete Restrict, so properties must cascade from
  // the user only after its invoices are gone.
  await a.cleanup()
  await b.cleanup()
  await app.close()
})

describe('per-tenant invoice numbering', () => {
  it('gives a tenant with no numbered invoices the number 1', async () => {
    const res = await create(b.cookie)
    expect(res.statusCode).toBe(201)
    // Before scoping, this returned the GLOBAL max + 1 — the seeded landlord
    // has hundreds of invoices, so this came back in the hundreds.
    expect(res.json().invoiceNumber).toBe('1')
  })

  it("continues a tenant's own sequence, unaffected by another tenant", async () => {
    await seedNumbers(a.user.id, ['1', '2', '3'])

    // Tenant B creating invoices must not advance tenant A's sequence.
    await create(b.cookie)

    const next = await create(a.cookie)
    expect(next.statusCode).toBe(201)
    expect(next.json().invoiceNumber).toBe('4')
  })

  it('lets two tenants each hold the same invoice number', async () => {
    const first = await create(a.cookie, { invoiceNumber: 'SHARED-1' })
    expect(first.statusCode).toBe(201)

    // Same number, different owner: allowed, and B learns nothing about A.
    const second = await create(b.cookie, { invoiceNumber: 'SHARED-1' })
    expect(second.statusCode).toBe(201)
    expect(second.json().invoiceNumber).toBe('SHARED-1')
  })

  it('still rejects a duplicate number within one tenant', async () => {
    const first = await create(b.cookie, { invoiceNumber: 'DUPE-1' })
    expect(first.statusCode).toBe(201)

    const dupe = await create(b.cookie, { invoiceNumber: 'DUPE-1' })
    expect(dupe.statusCode).toBe(409)
  })

  it('allows a tenant to hold many unnumbered invoices at once', async () => {
    // Contractor submissions are unnumbered until approved; the composite
    // unique must not collapse them (Postgres NULLs are never equal).
    for (const n of ['a', 'b', 'c']) {
      await app.prisma.invoice.create({
        data: {
          invoiceNumber: null,
          vendorName: `null-${n}`,
          amount: 100,
          invoiceDate: new Date('2026-02-01'),
          status: 'SUBMITTED',
          userId: b.user.id,
        },
      })
    }
    const unnumbered = await app.prisma.invoice.count({
      where: { userId: b.user.id, invoiceNumber: null },
    })
    expect(unnumbered).toBe(3)
  })

  it("stamps an approved submission with the owner's next number", async () => {
    // A fresh tenant so the expected number is deterministic: they own exactly
    // one numbered invoice ("7"), so approving a submission must yield "8".
    const c = await createSecondUser(app)
    try {
      await seedNumbers(c.user.id, ['7'])
      const property = await app.prisma.property.create({
        data: { landlordId: c.user.id, name: 'Prop', address: '1 Test St' },
      })
      const submission = await app.prisma.invoice.create({
        data: {
          invoiceNumber: null,
          vendorName: 'Submission',
          amount: 100,
          invoiceDate: new Date('2026-02-01'),
          status: 'SUBMITTED',
          category: 'OTHER',
          propertyId: property.id,
          userId: c.user.id,
          items: { createMany: { data: [{ description: 'Work', quantity: 1, total: 100, sortOrder: 0 }] } },
        },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/invoices/${submission.id}`,
        payload: { status: 'APPROVED' },
        headers: { cookie: c.cookie },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().invoiceNumber).toBe('8')
    } finally {
      await c.cleanup()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- invoices.numbering
```

Expected: FAIL. The first test should report an `invoiceNumber` in the hundreds (the seeded landlord's global max + 1) instead of `'1'` — that is the global scan, and it is exactly the defect this task removes.

- [ ] **Step 3: Scope the scan**

In `apps/api/src/invoices/writeService.ts`, change `nextInvoiceNumber` (around line 171) to take the owner and filter by it. Update its doc comment too:

```ts
/**
 * Next sequential invoice number **for one owner**, scanning that owner's max.
 * Runs on the transaction client so the read-max and the insert stay
 * race-consistent within the same transaction; the auto-number retry (in the
 * handler) opens a fresh transaction per attempt.
 *
 * Scoped by `userId`: numbers are unique per tenant, not globally
 * (`@@unique([userId, invoiceNumber])`). An unscoped scan would start a new
 * landlord's first invoice at the incumbent's max + 1, leaking their count.
 *
 * The max is computed by parsing in memory rather than a SQL `MAX()` because
 * the column is a string — `"9" > "10"` lexicographically.
 */
async function nextInvoiceNumber(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const rows = await tx.invoice.findMany({ where: { userId }, select: { invoiceNumber: true } })
  let max = 0
  for (const { invoiceNumber } of rows) {
    // invoiceNumber is nullable (contractor submissions are unnumbered until
    // approved) — skip nulls when scanning for the max.
    if (!invoiceNumber) continue
    const n = Number.parseInt(invoiceNumber, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}
```

- [ ] **Step 4: Update both call sites**

At the create site (around line 248), pass the acting user:

```ts
    const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(tx, actorId))
```

At the APPROVED-transition site (around line 485), pass the same:

```ts
      if (next === 'APPROVED' && before.invoiceNumber === null) {
        data.invoiceNumber = await nextInvoiceNumber(tx, actorId)
      }
```

`actorId` is correct at both sites: `updateInvoice` fetches `before` with `where: { id, userId: actorId }`, so the invoice's owner and the actor are the same by construction.

- [ ] **Step 5: Run the new tests to verify they pass**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api -- invoices.numbering
```
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full suite and the other workspaces**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
npm test -w @mac-invoices/shared
npm test -w @mac-invoices/web
npm run lint && npm run typecheck
```
Expected: all green. Existing invoice tests assert the landlord's own sequence, which is unchanged — if one fails, confirm it is not the known flake before investigating.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/invoices/writeService.ts apps/api/test/invoices.numbering.test.ts
git commit -m "feat(api): scope invoice numbering to the owning landlord

nextInvoiceNumber scanned every invoice in the table, so a newly signed-up
landlord's first invoice was numbered (global max + 1) -- silently reporting
the incumbent's invoice count. Scoped to the owner, a new tenant starts at 1
and each landlord's sequence is independent.

Also bounds the scan, which previously loaded every invoice number in the
table into memory on each create."
```

---

### Task 3: Decision record + deployment note

**Files:**
- Modify: `docs/DECISIONS.md` (add DEC-030; update DEC-029(j))
- Modify: `docs/DEPLOYMENT.md` (§3 migration ordering note)

**Interfaces:**
- Consumes: Tasks 1 and 2. Produces no code.

- [ ] **Step 1: Record DEC-030**

Append to `docs/DECISIONS.md`, matching the house style of DEC-027/DEC-028/DEC-029 (a bolded title line, then lettered sub-points):

```markdown
## Per-tenant invoice numbering (2026-08-07)

- **DEC-030 — Invoice numbers are unique and sequential per landlord, not globally** (plan: `docs/plans/2026-08-07-002-feat-per-tenant-invoice-numbering-plan.md`, spec: `docs/brainstorms/2026-08-07-per-tenant-invoice-numbering-requirements.md`). **Closes DEC-029(j)**, which recorded this as the blocker on enabling signup for real multi-tenant use. (a) **`@@unique([userId, invoiceNumber])` replaces the global `@unique`**, and `nextInvoiceNumber()` scopes its max-scan by `userId`. Both halves are required: scoping only the scan would leave the cross-tenant 409 in place as an existence oracle, and changing only the constraint would leave a new tenant's first number at the incumbent's max + 1. (b) **Non-destructive migration, no backfill** (`20260807120000_per_tenant_invoice_numbering`): every existing number was already globally unique, so existing rows satisfy the composite constraint untouched. Existing numbers were deliberately NOT renumbered — they already appear in exported PDFs, in the mirrored Google Sheet, and potentially in documents handed to third parties, so rewriting them would invalidate records outside the system. A new landlord's first invoice is `1`, which falls out of the scoping rather than needing its own rule. (c) **Migrate before deploying the code** (the usual `docs/DEPLOYMENT.md` §3 order, unlike `drop_invoice_description` which inverted it): in the window between, the old global scan still yields a number satisfying the composite constraint and same-tenant duplicates still conflict — the only behavior the migration alone unlocks is cross-tenant reuse, the intended end state. (d) **NULLs stay distinct**: Postgres treats NULLs as never-equal, so a landlord may still hold many unnumbered invoices at once, which contractor submissions require (they carry no number until approved, KTD-11). No partial index and no `NULLS NOT DISTINCT`. (e) **The max is still parsed in memory, not via SQL `MAX()`** — the column is a string, so `MAX()` would be lexicographic (`"9" > "10"`). Scoping already bounds the scan to one tenant, which also removes an unbounded per-create read. (f) **Rejected: per-tenant prefixes** (`AB-1`, `CD-1`) — would need a new `User` field and would either change the incumbent's existing numbers or leave their old and new invoices inconsistent; numbers are only ever displayed within one landlord's own context. (g) **Dropping the global unique also removed `invoiceNumber` as a Prisma unique selector**, so `prisma/seed.ts`'s upsert moved to `where: { userId_invoiceNumber: { … } }`. This was the only such usage in the codebase.
```

- [ ] **Step 2: Update DEC-029(j) so it no longer reads as open**

DEC-029(j) currently ends with "**Must be closed before signup is enabled for real multi-tenant use** — today's deploys have `SIGNUP_INVITE_CODE` unset, so this is latent, not live." Append a closing pointer so a reader does not treat it as outstanding:

```markdown
 **CLOSED by DEC-030 (2026-08-07)** — the composite unique and the scoped scan both landed; see that entry for what shipped.
```

Do not rewrite the rest of (j) — its description of the defect is the historical record of why DEC-030 exists.

- [ ] **Step 3: Add the deployment ordering note**

In `docs/DEPLOYMENT.md` §3 (migrations), add a note recording this migration's ordering, next to the existing guidance:

```markdown
> **`20260807120000_per_tenant_invoice_numbering` follows the normal order: migrate FIRST, then deploy.**
> It only swaps a unique index (global `invoiceNumber` → composite `(userId, invoiceNumber)`) and rewrites
> no rows. Between migrating and deploying, the still-running old code's global number scan yields a value
> that satisfies the new constraint, and same-tenant duplicates still conflict — so the window is safe.
> Contrast `drop_invoice_description`, which is destructive and inverts this rule.
```

- [ ] **Step 4: Verify the full suite once more**

```bash
npm run lint && npm run typecheck
npm test -w @mac-invoices/shared
npm test -w @mac-invoices/web
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/DEPLOYMENT.md
git commit -m "docs: DEC-030 per-tenant invoice numbering; closes DEC-029(j)

Records the composite-unique + scoped-scan change, why existing numbers
were not renumbered, and why this migration follows the normal
migrate-first order."
```

---

## Operator follow-up (human, not the implementer)

This plan applies the migration to the **local** database only. Applying it to the hosted database is a deliberate operator step, to be run before deploying the Task 2 code:

```bash
DATABASE_URL="<hosted-url>" npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| R1 per-landlord sequential numbering | 2 |
| R2 cross-tenant number reuse allowed, no signal | 1 (constraint), 2 (test) |
| R3 same-landlord duplicate still fails | 1 (constraint), 2 (test) |
| R4 many unnumbered invoices per landlord | 1 (NULL semantics), 2 (test) |
| R5 no existing number rewritten | 1 (no backfill; Step 5/7 verification) |
| R6 first invoice is `1` | 2 |
| R7 approved submissions follow the same rule | 2 |
| R8 seed stays runnable and idempotent | 1 (Steps 6-7) |
