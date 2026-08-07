# Vendors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `Contractor` entity to `Vendor` across code and database, split its `contact` field into `phone`/`email`, serve vendor management at `/vendors`, let the invoice form pick or implicitly create vendors, and drive the PDF Sender block from the linked vendor.

**Architecture:** Predominantly a mechanical rename plus a field split. The no-login submission-link system is retained verbatim apart from naming. Two distinct FKs from `Invoice` to `Vendor` are introduced/preserved: `vendorId` (attribution, drives the PDF) and `submittedByVendorId` (provenance **and** authorization scope). Vendor auto-creation happens server-side inside the existing invoice-write transaction.

**Tech Stack:** Fastify + Prisma (Postgres) API, React 19 + React Router 7 + TanStack Query + React Hook Form web, Zod schemas shared via `@mac-invoices/shared`, Vitest, jsPDF + jspdf-autotable.

**Spec:** `docs/brainstorms/2026-08-07-vendors-requirements.md`

## Global Constraints

- **Definition of Done:** `npm run lint && npm run typecheck && npm run test` all green.
- **Run everything against the LOCAL database.** This worktree's `.env` already points `DATABASE_URL` at `postgresql://postgres:postgres@localhost:5433/invoices_vendors` (docker). This database is **dedicated to this worktree** — the shared `invoices` database is also used by the main checkout, where a concurrent session applies its own migrations. Never run a migration or test against the hosted DB or against `invoices`.
- Start Postgres with `docker start mac-invoices-db` if it is not running.
- The `apps/api` suite has a **pre-existing intermittent failure (~1 run in 3)** from a race on the shared landlord row across parallel test files. If a single api file fails, re-run that file alone before treating it as a regression.
- `name` stays bounded to **max 100** — it is defaulted into `Invoice.vendorName`, which is `max(100)`.
- `phone` max 50; `email` max 200 and email-validated.
- Public submission route `/submit/:token` and all token semantics are **unchanged**. Do not alter `apps/api/src/vendors/token.ts` logic.
- Historical docs under `docs/plans/` and `docs/brainstorms/` keep their original "contractor" wording. Only `CLAUDE.md` and `docs/DECISIONS.md` get updated (Task 9).
- Prettier is enforced: run `npx prettier --write <files>` before each commit.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `packages/shared/src/schemas/vendor.ts` | Vendor + submission Zod schemas (renamed from `contractor.ts`) | 1 |
| `packages/shared/test/vendor.test.ts` | Schema tests (renamed) | 1 |
| `apps/api/prisma/schema.prisma` | Model/enum/FK renames, `phone`/`email`, `vendorId` | 2 |
| `apps/api/prisma/migrations/<ts>_rename_contractor_to_vendor/migration.sql` | Hand-written data-preserving migration | 2 |
| `apps/api/src/vendors/{handlers,routes,token}.ts` | Vendor CRUD + link management (renamed dir) | 3 |
| `apps/api/src/invoices/writeService.ts` | FK rename, actor prefix, vendor auto-create | 4, 5 |
| `apps/api/src/submissions/handlers.ts` | Authz scope rename | 4 |
| `apps/api/src/notifications/{feed,digest}.ts` | `actorId` prefix constant rename | 4 |
| `apps/web/src/pages/Vendors.tsx`, `VendorSubmit.tsx` | Vendor pages (renamed) | 6 |
| `apps/web/src/hooks/useVendors.ts` | Vendor queries/mutations (renamed) | 6 |
| `apps/web/src/components/VendorLinkCard.tsx` | Link display card (renamed) | 6 |
| `apps/web/src/components/InvoiceForm.tsx` | Vendor combobox | 7 |
| `apps/web/src/lib/invoicePdf.ts` | Sender from vendor, variable-height block | 8 |

---

### Task 1: Shared vendor schemas

**Files:**
- Rename: `packages/shared/src/schemas/contractor.ts` → `packages/shared/src/schemas/vendor.ts`
- Modify: `packages/shared/src/index.ts`
- Rename test: `packages/shared/test/contractor.test.ts` → `packages/shared/test/vendor.test.ts`

**Interfaces:**
- Produces: `CreateVendorSchema`, `UpdateVendorSchema`, `VendorSchema`, `VendorWithLinkSchema`, and types `CreateVendorInput`, `UpdateVendorInput`, `Vendor`, `VendorWithLink`. `Vendor` is `{ id, name, phone: string | null, email: string | null, linkActive, lastUsedAt, createdAt }`. `SubmissionSchema`, `EditSubmissionSchema`, `SubmissionStatusSchema` are unchanged apart from comment wording.

- [ ] **Step 1: Rename the files with git**

```bash
git mv packages/shared/src/schemas/contractor.ts packages/shared/src/schemas/vendor.ts
git mv packages/shared/test/contractor.test.ts packages/shared/test/vendor.test.ts
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/shared/test/vendor.test.ts` (and update its existing `CreateContractorSchema` references to `CreateVendorSchema`, `contact: 'x'` → `email: 'a@b.com'`):

```ts
import { describe, expect, it } from 'vitest'
import { CreateVendorSchema, UpdateVendorSchema } from '../src/schemas/vendor'

describe('CreateVendorSchema', () => {
  it('accepts a vendor with only an email', () => {
    const parsed = CreateVendorSchema.parse({ name: 'Ace Plumbing', email: 'ace@example.com' })
    expect(parsed).toEqual({ name: 'Ace Plumbing', email: 'ace@example.com' })
  })

  it('accepts a vendor with only a phone', () => {
    const parsed = CreateVendorSchema.parse({ name: 'Ace Plumbing', phone: '555-0100' })
    expect(parsed.phone).toBe('555-0100')
  })

  it('rejects a vendor with neither phone nor email', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace Plumbing' })
    expect(result.success).toBe(false)
  })

  it('rejects a vendor whose phone and email are blank strings', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace', phone: '   ', email: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed email', () => {
    const result = CreateVendorSchema.safeParse({ name: 'Ace', email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a name longer than 100 characters', () => {
    const result = CreateVendorSchema.safeParse({ name: 'a'.repeat(101), email: 'a@b.com' })
    expect(result.success).toBe(false)
  })

  it('allows a partial update that clears neither field', () => {
    expect(UpdateVendorSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx --workspace @mac-invoices/shared vitest run test/vendor.test.ts`
Expected: FAIL — `CreateVendorSchema` is not exported.

- [ ] **Step 4: Rewrite the contact field as phone/email**

In `packages/shared/src/schemas/vendor.ts`, replace the `CreateContractorSchema` / `ContractorSchema` block with:

```ts
// A lightweight vendor the landlord collects invoices from via a no-login
// link. NOT a User — no password, no session. The link token is a bearer
// credential; the API never returns the token secret/hash, only whether the
// link is active. The full plaintext link is surfaced exactly once, in the
// create/regenerate response (see VendorWithLinkSchema).

// Phone and email are both optional columns, but at least one must be present
// on a landlord-entered vendor. The DB keeps both nullable because the invoice
// auto-create path deliberately writes a name-only vendor (see the plan's Task 5).
export const CreateVendorSchema = z
  .object({
    // Bounded to Invoice.vendorName (max 100) — the name is defaulted into a
    // submission's vendorName, so an over-long name would otherwise fail submit.
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(50).optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
  })
  .refine((v) => v.phone != null || v.email != null, {
    message: 'Provide a phone number or an email address',
    path: ['phone'],
  })

export const UpdateVendorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
})

/** The vendor as the landlord lists/views them — never the token secret. */
export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkActive: z.boolean(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

/** create/regenerate responses carry the one-time plaintext link. */
export const VendorWithLinkSchema = VendorSchema.extend({ link: z.string() })

export type CreateVendorInput = z.infer<typeof CreateVendorSchema>
export type UpdateVendorInput = z.infer<typeof UpdateVendorSchema>
export type Vendor = z.infer<typeof VendorSchema>
export type VendorWithLink = z.infer<typeof VendorWithLinkSchema>
```

Note: `.trim().min(1)` on `phone` makes a whitespace-only string fail rather than becoming a blank vendor contact. An empty-string `email` fails `.email()` for the same reason.

- [ ] **Step 5: Update the barrel export**

In `packages/shared/src/index.ts`, change `export * from './schemas/contractor'` to `export * from './schemas/vendor'`. Also replace the word "contractor" with "vendor" in the comments of `packages/shared/src/schemas/{invoice,notification,property}.ts` (comment text only — no identifier in those three files changes in this task).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx --workspace @mac-invoices/shared vitest run`
Expected: PASS — all shared suites green.

- [ ] **Step 7: Commit**

```bash
npx prettier --write packages/shared/src packages/shared/test
git add packages/shared
git commit -m "feat(shared): rename Contractor schemas to Vendor with phone/email split"
```

---

### Task 2: Prisma schema and the data-preserving migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260807190000_rename_contractor_to_vendor/migration.sql`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: Prisma model `Vendor` (table `vendors`) with `phone String?` / `email String?`; `Invoice.vendorId String?` + relation `vendor`; `Invoice.submittedByVendorId` + relation `submittedByVendor`; `Role.VENDOR`. Later tasks use the Prisma client accessor `prisma.vendor`.

- [ ] **Step 1: Edit the schema — the Vendor model**

In `apps/api/prisma/schema.prisma`, replace the `Contractor` model and its doc comment with:

```prisma
// A lightweight vendor the landlord collects invoices from via a no-login
// tokenized link. NOT a User: no password, no session. The link is a bearer
// credential — `tokenLookupId` is a non-secret indexed handle for a point
// lookup; `tokenHash` is the SHA-256 of the secret (never stored in plaintext,
// mirroring Session). `revokedAt` invalidates the link; regenerate overwrites
// the lookupId + hash. A vendor belongs to exactly one landlord (v1).
//
// `phone` and `email` are both nullable: the invoice-form auto-create path
// writes a name-only vendor. The "at least one contact" rule is enforced in
// Zod (CreateVendorSchema) for landlord-entered vendors only.
model Vendor {
  id            String    @id @default(cuid())
  landlordId    String
  landlord      User      @relation(fields: [landlordId], references: [id], onDelete: Cascade)
  name          String
  phone         String?
  email         String?
  tokenLookupId String    @unique
  tokenHash     String
  revokedAt     DateTime?
  lastUsedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  submissions   Invoice[] @relation("InvoiceSubmittedByVendor")
  invoices      Invoice[] @relation("InvoiceVendor")

  @@index([landlordId])
  @@map("vendors")
}
```

Two named relations are required now that `Invoice` points at `Vendor` twice — Prisma cannot disambiguate them otherwise.

- [ ] **Step 2: Edit the schema — User, Invoice, Role**

In `model User`, change `contractors  Contractor[]` to `vendors      Vendor[]`.

In `model Invoice`, replace the `submittedByContractorId` block with:

```prisma
  // The vendor who submitted this invoice, if any. The invoice is still
  // owned by the landlord (`userId`); this only records the submitter, AND it
  // is the authorization scope for that vendor's no-login link (see
  // submissions/handlers.ts). SetNull so deleting a vendor never cascades into
  // the landlord's owned invoice.
  submittedByVendorId    String?
  submittedByVendor      Vendor?          @relation("InvoiceSubmittedByVendor", fields: [submittedByVendorId], references: [id], onDelete: SetNull)
  // Attribution: which vendor this invoice is FROM. Set by the invoice form's
  // picker or by auto-create. Deliberately separate from submittedByVendorId —
  // sharing one column would let a vendor's public link read landlord-entered
  // invoices merely attributed to them.
  vendorId               String?
  vendor                 Vendor?          @relation("InvoiceVendor", fields: [vendorId], references: [id], onDelete: SetNull)
```

Replace the index `@@index([submittedByContractorId])` with:

```prisma
  @@index([submittedByVendorId])
  @@index([vendorId])
```

In `enum Role`, change `CONTRACTOR` to `VENDOR`.

Finally, update the `Property` model's comment "mirrors the Contractor entity" to "mirrors the Vendor entity".

- [ ] **Step 3: Hand-write the migration**

Create `apps/api/prisma/migrations/20260807190000_rename_contractor_to_vendor/migration.sql`. Write it by hand — do NOT let `prisma migrate dev` autogenerate it, because Prisma would emit DROP+CREATE for the renames and destroy every row.

```sql
-- Rename the table and its constraints/indexes. RENAME (never DROP+CREATE)
-- so no row is lost.
ALTER TABLE "contractors" RENAME TO "vendors";
ALTER INDEX "contractors_pkey" RENAME TO "vendors_pkey";
ALTER INDEX "contractors_tokenLookupId_key" RENAME TO "vendors_tokenLookupId_key";
ALTER INDEX "contractors_landlordId_idx" RENAME TO "vendors_landlordId_idx";
ALTER TABLE "vendors" RENAME CONSTRAINT "contractors_landlordId_fkey" TO "vendors_landlordId_fkey";

-- Split the single free-text `contact` column into phone + email.
ALTER TABLE "vendors" ADD COLUMN "phone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "email" TEXT;

-- Backfill: an email-shaped contact becomes `email`, anything else `phone`.
UPDATE "vendors" SET "email" = "contact" WHERE "contact" LIKE '%_@_%.__%';
UPDATE "vendors" SET "phone" = "contact" WHERE "contact" NOT LIKE '%_@_%.__%';

ALTER TABLE "vendors" DROP COLUMN "contact";

-- Invoice: rename the submission FK, then add the attribution FK.
ALTER TABLE "invoices" RENAME COLUMN "submittedByContractorId" TO "submittedByVendorId";
ALTER INDEX "invoices_submittedByContractorId_idx" RENAME TO "invoices_submittedByVendorId_idx";
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_submittedByContractorId_fkey" TO "invoices_submittedByVendorId_fkey";

ALTER TABLE "invoices" ADD COLUMN "vendorId" TEXT;
CREATE INDEX "invoices_vendorId_idx" ON "invoices"("vendorId");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Role enum value.
ALTER TYPE "Role" RENAME VALUE 'CONTRACTOR' TO 'VENDOR';

-- InvoiceEvent.actorId stores a literal 'contractor:<id>' prefix as DATA.
-- Renaming only the TypeScript constant would silently orphan every historical
-- event from the notifications feed and digest — no error, they would just stop
-- appearing. Migrate the stored rows in the same migration.
UPDATE "invoice_events"
SET "actorId" = 'vendor:' || substring("actorId" from 12)
WHERE "actorId" LIKE 'contractor:%';
```

If any `ALTER INDEX` / `RENAME CONSTRAINT` name does not exist, confirm the real name first with:

```bash
docker exec mac-invoices-db psql -U postgres -d invoices -c "\d contractors"
```

and correct the statement rather than deleting it.

- [ ] **Step 4: Apply the migration to the LOCAL database**

```bash
docker start mac-invoices-db
npm run db:migrate
npm run db:generate
```

Expected: the migration applies cleanly and the Prisma client regenerates.

- [ ] **Step 5: Verify the rename preserved data**

```bash
docker exec mac-invoices-db psql -U postgres -d invoices -c "\d vendors"
docker exec mac-invoices-db psql -U postgres -d invoices -c "SELECT id, name, phone, email FROM vendors LIMIT 5;"
docker exec mac-invoices-db psql -U postgres -d invoices -c "SELECT DISTINCT split_part(\"actorId\", ':', 1) FROM invoice_events;"
```

Expected: the `vendors` table exists with `phone`/`email` and no `contact`; every pre-existing row has exactly one of phone/email populated; no `actorId` prefix reads `contractor`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): migrate contractors table to vendors with phone/email split"
```

Note: `npm run typecheck` is expected to FAIL after this task — the API still references `prisma.contractor`. Tasks 3–5 fix it. Do not attempt to fix typecheck here.

---

### Task 3: API vendors module

**Files:**
- Rename: `apps/api/src/contractors/` → `apps/api/src/vendors/` (`handlers.ts`, `routes.ts`, `token.ts`)
- Modify: `apps/api/src/app.ts`
- Rename tests: `apps/api/test/contractors.{crud,schema,token}.test.ts` → `apps/api/test/vendors.{crud,schema,token}.test.ts`

**Interfaces:**
- Consumes: `CreateVendorSchema`, `UpdateVendorSchema` from Task 1; `prisma.vendor` from Task 2.
- Produces: routes `POST /api/vendors`, `GET /api/vendors`, `GET /api/vendors/:id`, `PATCH /api/vendors/:id`, `POST /api/vendors/:id/revoke`, `POST /api/vendors/:id/regenerate`. Exports `freshLinkData()` (unchanged signature) — `apps/api/src/submissions/` imports it.

- [ ] **Step 1: Rename the directory and tests**

```bash
git mv apps/api/src/contractors apps/api/src/vendors
git mv apps/api/test/contractors.crud.test.ts apps/api/test/vendors.crud.test.ts
git mv apps/api/test/contractors.schema.test.ts apps/api/test/vendors.schema.test.ts
git mv apps/api/test/contractors.token.test.ts apps/api/test/vendors.token.test.ts
```

- [ ] **Step 2: Write the failing test**

Add to `apps/api/test/vendors.crud.test.ts` (keep its existing setup helpers; adapt their `contact:` payloads to `email:`):

```ts
it('creates a vendor with separate phone and email', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    cookies: { session: landlordSession },
    payload: { name: 'Ace Plumbing', phone: '555-0100', email: 'ace@example.com' },
  })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.name).toBe('Ace Plumbing')
  expect(body.phone).toBe('555-0100')
  expect(body.email).toBe('ace@example.com')
  expect(body.link).toContain('/submit/')
  // The token secret and hash must never leave the server.
  expect(body.tokenHash).toBeUndefined()
  expect(body.tokenLookupId).toBeUndefined()
})

it('rejects a vendor with neither phone nor email', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    cookies: { session: landlordSession },
    payload: { name: 'No Contact' },
  })
  expect(res.statusCode).toBe(400)
})

it('updates only the supplied contact field', async () => {
  const created = await app
    .inject({
      method: 'POST',
      url: '/api/vendors',
      cookies: { session: landlordSession },
      payload: { name: 'Ace', phone: '555-0100' },
    })
    .then((r) => r.json())

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/vendors/${created.id}`,
    cookies: { session: landlordSession },
    payload: { email: 'ace@example.com' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().email).toBe('ace@example.com')
  expect(res.json().phone).toBe('555-0100')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx --workspace @mac-invoices/api vitest run test/vendors.crud.test.ts`
Expected: FAIL — the route is still `/api/contractors` and `prisma.contractor` no longer exists.

- [ ] **Step 4: Rewrite the handlers**

In `apps/api/src/vendors/handlers.ts`, apply these edits:

Replace the row type and mapper:

```ts
import { CreateVendorSchema, UpdateVendorSchema } from '@mac-invoices/shared'

type VendorRow = {
  id: string
  name: string
  phone: string | null
  email: string | null
  revokedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

/** Landlord-facing shape — never the token secret/hash, only whether it's live. */
function toVendor(v: VendorRow) {
  return {
    id: v.id,
    name: v.name,
    phone: v.phone,
    email: v.email,
    linkActive: v.revokedAt === null,
    lastUsedAt: v.lastUsedAt,
    createdAt: v.createdAt,
  }
}
```

Replace `ownContractor` with:

```ts
/** Find a vendor scoped to the landlord, or 404 (no existence leak). */
async function ownVendor(prisma: PrismaClient, id: string, landlordId: string) {
  const v = await prisma.vendor.findFirst({ where: { id, landlordId } })
  if (!v) throw new AppError('NOT_FOUND', 'Vendor not found', 404)
  return v
}
```

Replace the create handler's data block:

```ts
export async function createVendor(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateVendorSchema, request.body)
  const { columns, plaintext } = freshLinkData()
  const v = await request.server.prisma.vendor.create({
    data: {
      landlordId: request.user.id,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      ...columns,
    },
  })
  return reply.code(201).send({ ...toVendor(v), link: linkUrl(plaintext) })
}
```

Replace the update handler's data block:

```ts
export async function updateVendor(
  request: FastifyRequest<{ Params: Params }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateVendorSchema, request.body)
  await ownVendor(request.server.prisma, request.params.id, request.user.id)
  const v = await request.server.prisma.vendor.update({
    where: { id: request.params.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email }),
    },
  })
  return reply.send(toVendor(v))
}
```

Rename the remaining exports: `listContractors`→`listVendors`, `getContractor`→`getVendor`, and inside `revokeLink`/`regenerateLink` swap `prisma.contractor`→`prisma.vendor`, `ownContractor`→`ownVendor`, `toContractor`→`toVendor`. Update the doc comments to say "vendor". `freshLinkData()` and `linkUrl()` keep their current bodies — only the word "contractor" in their comments changes.

- [ ] **Step 5: Update routes and registration**

In `apps/api/src/vendors/routes.ts`, change every path prefix `/api/contractors` to `/api/vendors` and update the imported handler names to those above. In `apps/api/src/app.ts`, rename the import and the `app.register(contractorRoutes)` call to `vendorRoutes`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx --workspace @mac-invoices/api vitest run test/vendors.crud.test.ts test/vendors.schema.test.ts test/vendors.token.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/api/src apps/api/test
git add apps/api
git commit -m "feat(api): rename contractors module to vendors with phone/email"
```

---

### Task 4: Rename the FK, the authz scope, and the event actor prefix

**Files:**
- Modify: `apps/api/src/invoices/{writeService,handlers,routes,sheetRows,sheetSync}.ts`
- Modify: `apps/api/src/submissions/{handlers,routes}.ts`
- Modify: `apps/api/src/notifications/{feed,digest,routes}.ts`
- Modify: `apps/api/src/properties/routes.ts`, `apps/api/prisma/sweep-orphan-blobs.ts`
- Modify: `apps/api/test/submissions.scope.test.ts`

**Interfaces:**
- Consumes: `prisma.vendor`, `Invoice.submittedByVendorId` from Task 2.
- Produces: `vendorActorId(id: string): string` returning `` `vendor:${id}` ``, and `vendorBlobOwner(id: string): string`. `createSubmission(prisma, args: { ownerUserId: string; vendorId: string; vendorName: string }, input)`. `vendorUpdateSubmission(prisma, args: { vendorId: string; invoiceId: string }, input)`.

- [ ] **Step 1: Write the failing authz regression test**

Add to `apps/api/test/submissions.scope.test.ts`:

```ts
it('a link holder cannot read an invoice merely ATTRIBUTED to them', async () => {
  // The landlord enters an invoice themselves and attributes it to the vendor
  // (vendorId), but the vendor did NOT submit it (submittedByVendorId is null).
  // The vendor's no-login link must not reach it.
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: 'ATTR-1',
      vendorName: 'Ace Plumbing',
      amount: 100,
      currency: 'USD',
      category: 'REPAIRS',
      invoiceDate: new Date('2026-01-15'),
      status: 'APPROVED',
      userId: landlordId,
      vendorId,
      submittedByVendorId: null,
      items: { createMany: { data: [{ description: 'x', quantity: 1, total: 100, sortOrder: 0 }] } },
    },
  })

  const list = await app.inject({ method: 'GET', url: `/api/submissions?token=${plaintextToken}` })
  expect(list.statusCode).toBe(200)
  expect(list.json().data.map((r: { id: string }) => r.id)).not.toContain(invoice.id)

  const edit = await app.inject({
    method: 'PATCH',
    url: `/api/submissions/${invoice.id}?token=${plaintextToken}`,
    payload: { amount: 5 },
  })
  expect(edit.statusCode).toBe(409)
})
```

Adapt `landlordId`, `vendorId`, and `plaintextToken` to the fixture names already used in that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --workspace @mac-invoices/api vitest run test/submissions.scope.test.ts`
Expected: FAIL — `vendorId` is not yet accepted by the code paths and the module still references `submittedByContractorId`.

- [ ] **Step 3: Rename the actor-prefix constants**

In `apps/api/src/notifications/feed.ts` and `apps/api/src/notifications/digest.ts`, change:

```ts
const CONTRACTOR = 'contractor:'
```

to:

```ts
// Must stay in lockstep with vendorActorId() in invoices/writeService.ts and with
// the stored value — the rename migration rewrote historical rows to this prefix.
const VENDOR = 'vendor:'
```

Update every use (`startsWith: CONTRACTOR`, `slice(CONTRACTOR.length)`) to `VENDOR`, rename the local `contractorIds`→`vendorIds` and the response field `contractorName`→`vendorName`, and change the digest's fallback string `'A contractor'` to `'A vendor'`.

- [ ] **Step 4: Rename the write-service identifiers**

In `apps/api/src/invoices/writeService.ts`:
- `contractorActorId` → `vendorActorId`, returning `` `vendor:${id}` ``.
- `contractorBlobOwner` → `vendorBlobOwner`; keep its `c_<id>` blob prefix **unchanged** — that prefix is baked into already-uploaded blob paths, and changing it would orphan existing images. Add this comment above it:

```ts
// The blob path prefix stays `c_` deliberately: it is embedded in the storage
// keys of every image already uploaded. Renaming it would orphan them.
```

- `createSubmission`'s `args.contractorId` → `args.vendorId`; `submittedByContractor: { connect: ... }` → `submittedByVendor: { connect: { id: args.vendorId } }`.
- `contractorUpdateSubmission` → `vendorUpdateSubmission`; `args.contractorId` → `args.vendorId`; the scope object's `submittedByContractorId` → `submittedByVendorId`.

- [ ] **Step 5: Rename the remaining references**

Across `apps/api/src/invoices/handlers.ts`, `apps/api/src/submissions/{handlers,routes}.ts`, `apps/api/src/invoices/{routes,sheetRows,sheetSync}.ts`, `apps/api/src/notifications/routes.ts`, `apps/api/src/properties/routes.ts`, and `apps/api/prisma/sweep-orphan-blobs.ts`:

- `submittedByContractor` → `submittedByVendor`, `submittedByContractorId` → `submittedByVendorId`
- `prisma.contractor` → `prisma.vendor`
- the flattened response key `contractor:` → `vendor:` (in `invoices/handlers.ts` `listInvoices`), and `select: { name: true, contact: true }` → `select: { name: true, phone: true, email: true }`
- local identifiers `contractorId`/`contractor` → `vendorId`/`vendor`, and comment wording

Verify none are left:

```bash
grep -rn "ontractor" apps/api/src apps/api/prisma/*.ts | grep -v generated
```

Expected: no output.

- [ ] **Step 6: Run the API suite**

Run: `npx --workspace @mac-invoices/api vitest run`
Expected: PASS (re-run any single failing file alone — see Global Constraints).

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/api
git add apps/api
git commit -m "refactor(api): rename submission FK, authz scope, and event actor prefix to vendor"
```

---

### Task 5: Link and auto-create vendors on invoice write

**Files:**
- Modify: `packages/shared/src/schemas/invoice.ts`
- Modify: `apps/api/src/invoices/writeService.ts`
- Create: `apps/api/test/invoices.vendor-link.test.ts`

**Interfaces:**
- Consumes: `prisma.vendor`, `Invoice.vendorId` from Task 2.
- Produces: `CreateInvoiceSchema.vendorId?: string`; `resolveVendorId(tx, landlordId, vendorId, vendorName): Promise<string | null>` in `writeService.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/invoices.vendor-link.test.ts`. Model its app/session setup on `apps/api/test/invoices.property.test.ts`.

```ts
it('auto-creates a vendor when the invoice names an unknown one', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    cookies: { session: landlordSession },
    payload: {
      vendorName: 'Brand New Vendor',
      category: 'REPAIRS',
      invoiceDate: '2026-02-01',
      items: [{ description: 'work', quantity: 1, total: 50 }],
    },
  })
  expect(res.statusCode).toBe(201)

  const vendor = await prisma.vendor.findFirst({
    where: { landlordId, name: 'Brand New Vendor' },
  })
  expect(vendor).not.toBeNull()
  // Auto-created vendors carry no contact details and no usable link.
  expect(vendor?.phone).toBeNull()
  expect(vendor?.email).toBeNull()
  expect(vendor?.revokedAt).not.toBeNull()
  expect(res.json().vendorId).toBe(vendor?.id)
})

it('reuses an existing vendor regardless of case, creating only one row', async () => {
  const payload = (name: string) => ({
    vendorName: name,
    category: 'REPAIRS',
    invoiceDate: '2026-02-01',
    items: [{ description: 'work', quantity: 1, total: 50 }],
  })
  const opts = { method: 'POST' as const, url: '/api/invoices', cookies: { session: landlordSession } }

  const first = await app.inject({ ...opts, payload: payload('Ace Plumbing') })
  const second = await app.inject({ ...opts, payload: payload('ACE PLUMBING') })

  const rows = await prisma.vendor.findMany({
    where: { landlordId, name: { equals: 'Ace Plumbing', mode: 'insensitive' } },
  })
  expect(rows).toHaveLength(1)
  expect(first.json().vendorId).toBe(rows[0].id)
  expect(second.json().vendorId).toBe(rows[0].id)
})

it('does not steal another landlord’s vendor of the same name', async () => {
  await app.inject({
    method: 'POST',
    url: '/api/invoices',
    cookies: { session: otherLandlordSession },
    payload: {
      vendorName: 'Shared Name',
      category: 'REPAIRS',
      invoiceDate: '2026-02-01',
      items: [{ description: 'work', quantity: 1, total: 50 }],
    },
  })
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    cookies: { session: landlordSession },
    payload: {
      vendorName: 'Shared Name',
      category: 'REPAIRS',
      invoiceDate: '2026-02-01',
      items: [{ description: 'work', quantity: 1, total: 50 }],
    },
  })
  const rows = await prisma.vendor.findMany({ where: { name: 'Shared Name' } })
  expect(rows).toHaveLength(2)
  expect(res.json().vendorId).toBe(rows.find((r) => r.landlordId === landlordId)?.id)
})

it('rejects a vendorId belonging to another landlord', async () => {
  const foreign = await prisma.vendor.findFirst({ where: { landlordId: otherLandlordId } })
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    cookies: { session: landlordSession },
    payload: {
      vendorName: 'Whatever',
      vendorId: foreign!.id,
      category: 'REPAIRS',
      invoiceDate: '2026-02-01',
      items: [{ description: 'work', quantity: 1, total: 50 }],
    },
  })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx --workspace @mac-invoices/api vitest run test/invoices.vendor-link.test.ts`
Expected: FAIL — `vendorId` is not in the schema and no vendor is created.

- [ ] **Step 3: Accept `vendorId` in the shared schema**

In `packages/shared/src/schemas/invoice.ts`, add to `CreateInvoiceSchema` directly below `vendorEmail`:

```ts
  // The saved vendor this invoice is from. Optional: when omitted and
  // `vendorName` names a vendor the landlord doesn't have yet, the server
  // creates one and links it (see writeService.resolveVendorId).
  vendorId: z.string().optional(),
```

`UpdateInvoiceSchema` picks this up automatically via `CreateInvoiceSchema.partial()`.

- [ ] **Step 4: Implement the resolver**

Add to `apps/api/src/invoices/writeService.ts`:

```ts
/**
 * Resolve the vendor an invoice is attributed to, creating one when the
 * landlord typed a name they have no vendor for yet.
 *
 * Runs INSIDE the caller's transaction on purpose: a client-side
 * "create vendor, then create invoice" pair would leave an orphaned vendor
 * whenever the invoice write failed, and a double-submit would create two.
 *
 * An auto-created vendor gets no phone/email and is born with `revokedAt` set,
 * so it has no usable submission link until the landlord explicitly
 * regenerates one. The token columns are still populated because they are
 * NOT NULL and `tokenLookupId` is unique.
 */
export async function resolveVendorId(
  tx: Prisma.TransactionClient,
  landlordId: string,
  vendorId: string | undefined,
  vendorName: string | undefined,
): Promise<string | null> {
  if (vendorId != null) {
    // Scope to the landlord: 404 (not 403) so another landlord's vendor
    // existence never leaks — same rule as propertyId above.
    const owned = await tx.vendor.findFirst({ where: { id: vendorId, landlordId } })
    if (!owned) throw new AppError('NOT_FOUND', 'Vendor not found', 404)
    return owned.id
  }
  const name = vendorName?.trim()
  if (!name) return null

  const existing = await tx.vendor.findFirst({
    where: { landlordId, name: { equals: name, mode: 'insensitive' } },
  })
  if (existing) return existing.id

  const { columns } = freshLinkData()
  const created = await tx.vendor.create({
    data: { landlordId, name, phone: null, email: null, revokedAt: new Date(), ...columns },
  })
  return created.id
}
```

Add the import `import { freshLinkData } from '../vendors/handlers'` at the top of the file.

- [ ] **Step 5: Call it from createInvoice**

In `createInvoice`, immediately after the `propertyId` ownership check and before `nextInvoiceNumber`, insert:

```ts
    const resolvedVendorId = await resolveVendorId(tx, actorId, input.vendorId, input.vendorName)
```

Then add `vendorId: resolvedVendorId,` to the `tx.invoice.create({ data: { ... } })` block, directly below `vendorEmail`.

- [ ] **Step 6: Call it from updateInvoice**

In `updateInvoice`, inside the transaction and before the invoice `update` call, insert:

```ts
    // Re-resolve only when the caller actually touched the vendor, so an
    // unrelated PATCH (a status change, say) never re-links the invoice.
    if (input.vendorId !== undefined || input.vendorName !== undefined) {
      data.vendorId = await resolveVendorId(
        tx,
        actorId,
        input.vendorId,
        input.vendorName ?? before.vendorName,
      )
    }
```

Adapt `data` and `before` to the identifiers already used in that function.

- [ ] **Step 7: Also link submissions**

In `createSubmission`'s `tx.invoice.create` data block, add `vendorId: args.vendorId,` alongside the existing `submittedByVendor` connect, so a self-submitted invoice is attributed as well as attested.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx --workspace @mac-invoices/api vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
npx prettier --write apps/api packages/shared
git add apps/api packages/shared
git commit -m "feat(api): link invoices to vendors, auto-creating unknown vendor names"
```

---

### Task 6: Web vendor pages, hooks, and i18n

**Files:**
- Rename: `apps/web/src/pages/Contractors.tsx` → `Vendors.tsx`; `ContractorSubmit.tsx` → `VendorSubmit.tsx`
- Rename: `apps/web/src/hooks/useContractors.ts` → `useVendors.ts`
- Rename: `apps/web/src/components/ContractorLinkCard.tsx` → `VendorLinkCard.tsx`
- Modify: `apps/web/src/main.tsx`, `components/NavLinks.tsx`, `hooks/{useInvoice,useInvoices,useNotifications,useSubmission}.ts`, `components/{NotificationsBell,ReviewActions,PhotoAttach,LanguageSwitcher}.tsx`, `lib/needsPhoto.ts`, `pages/{InvoiceNew,InvoiceEdit}.tsx`
- Modify: `apps/web/src/locales/{en,zh}/translation.json`
- Rename tests: `apps/web/test/Contractors.test.tsx` → `Vendors.test.tsx`; `ContractorSubmit.test.tsx` → `VendorSubmit.test.tsx`

**Interfaces:**
- Consumes: `Vendor`, `VendorWithLink`, `CreateVendorInput` from Task 1; `/api/vendors` from Task 3.
- Produces: `useVendors()`, `useCreateVendor()`, `useRevokeLink()`, `useRegenerateLink()` from `hooks/useVendors.ts`. `useVendors()` returns `{ data: { data: Vendor[] } }` — Task 7 consumes it.

- [ ] **Step 1: Rename the files**

```bash
git mv apps/web/src/pages/Contractors.tsx apps/web/src/pages/Vendors.tsx
git mv apps/web/src/pages/ContractorSubmit.tsx apps/web/src/pages/VendorSubmit.tsx
git mv apps/web/src/hooks/useContractors.ts apps/web/src/hooks/useVendors.ts
git mv apps/web/src/components/ContractorLinkCard.tsx apps/web/src/components/VendorLinkCard.tsx
git mv apps/web/test/Contractors.test.tsx apps/web/test/Vendors.test.tsx
git mv apps/web/test/ContractorSubmit.test.tsx apps/web/test/VendorSubmit.test.tsx
```

- [ ] **Step 2: Write the failing test**

In `apps/web/test/Vendors.test.tsx`, replace the existing contact-field assertions with:

```ts
it('submits a new vendor with separate phone and email', async () => {
  const user = userEvent.setup()
  renderVendorsPage()

  await user.type(screen.getByLabelText(/name/i), 'Ace Plumbing')
  await user.type(screen.getByLabelText(/phone/i), '555-0100')
  await user.type(screen.getByLabelText(/email/i), 'ace@example.com')
  await user.click(screen.getByRole('button', { name: /add vendor/i }))

  await waitFor(() => {
    expect(postedBody()).toEqual({
      name: 'Ace Plumbing',
      phone: '555-0100',
      email: 'ace@example.com',
    })
  })
})

it('blocks submit when both phone and email are empty', async () => {
  const user = userEvent.setup()
  renderVendorsPage()

  await user.type(screen.getByLabelText(/name/i), 'No Contact')
  await user.click(screen.getByRole('button', { name: /add vendor/i }))

  expect(await screen.findByText(/phone number or an email/i)).toBeInTheDocument()
})
```

Adapt `renderVendorsPage` / `postedBody` to the harness already in that file.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx --workspace @mac-invoices/web vitest run test/Vendors.test.tsx`
Expected: FAIL — there is one Contact input, not separate Phone and Email.

- [ ] **Step 4: Update the hooks**

Rewrite `apps/web/src/hooks/useVendors.ts` — rename every symbol and swap the URLs and query key:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Vendor, VendorWithLink, CreateVendorInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// Landlord-side vendor management. The plaintext link is present only on the
// create/regenerate responses (VendorWithLink) — the list never carries it.

export function useVendors() {
  return useQuery<{ data: Vendor[] }>({
    queryKey: ['vendors'],
    queryFn: () => apiClient('/api/vendors'),
    retry: false,
  })
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateVendorInput) =>
      apiClient<VendorWithLink>('/api/vendors', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useRevokeLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<Vendor>(`/api/vendors/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useRegenerateLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<VendorWithLink>(`/api/vendors/${id}/regenerate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}
```

- [ ] **Step 5: Split the Contact input into Phone and Email**

In `apps/web/src/pages/Vendors.tsx`, replace the single contact field with two, wired to `CreateVendorSchema` through the existing `zodResolver`. Keep the file's existing `fieldClass` and error-rendering idiom:

```tsx
<div>
  <label htmlFor="phone" className="block text-sm font-medium mb-1">
    {t('vendors.phone')}
  </label>
  <input id="phone" type="tel" className={fieldClass} {...register('phone')} />
  {errors.phone && <p className="mt-1 text-sm text-destructive">{errors.phone.message}</p>}
</div>

<div>
  <label htmlFor="email" className="block text-sm font-medium mb-1">
    {t('vendors.email')}
  </label>
  <input id="email" type="email" className={fieldClass} {...register('email')} />
  {errors.email && <p className="mt-1 text-sm text-destructive">{errors.email.message}</p>}
</div>
```

Because `CreateVendorSchema`'s `.refine()` sets `path: ['phone']`, the "provide a phone or an email" message surfaces under the Phone field.

Where the page lists vendors, render `[v.phone, v.email].filter(Boolean).join(' · ')` in place of the old `v.contact`.

Also submit `undefined` rather than `''` for an untouched field, so the optional schema fields validate:

```tsx
const onSubmit = handleSubmit((values) =>
  createVendor.mutate({
    name: values.name,
    phone: values.phone?.trim() || undefined,
    email: values.email?.trim() || undefined,
  }),
)
```

- [ ] **Step 6: Update the routes**

In `apps/web/src/main.tsx`: rename the import to `Vendors` / `VendorSubmit`, change the child route to `{ path: 'vendors', element: <Vendors /> }`, and add the redirect above it:

```tsx
import { Navigate } from 'react-router'
// ...
{ path: 'contractors', element: <Navigate to="/vendors" replace /> },
```

Leave `{ path: '/submit/:token', element: <VendorSubmit /> }` at its current path.

In `apps/web/src/components/NavLinks.tsx`, change the entry to:

```ts
{ key: 'vendors', to: '/vendors', match: (p) => p.startsWith('/vendors') },
```

- [ ] **Step 7: Rename the remaining references**

In `hooks/{useInvoice,useInvoices,useNotifications,useSubmission}.ts`, `components/{NotificationsBell,ReviewActions,PhotoAttach,LanguageSwitcher}.tsx`, `lib/needsPhoto.ts`, and `pages/{InvoiceNew,InvoiceEdit}.tsx`: rename the `contractor` response field to `vendor`, `contractorName` to `vendorName`, and the type `{ name, contact }` to `{ name, phone, email }`. Update comment wording.

- [ ] **Step 8: Update both locale catalogues**

In `apps/web/src/locales/en/translation.json` and `.../zh/translation.json`, rename every `contractor*` key to `vendor*` and update the display strings ("Contractors" → "Vendors", 承包商 → 供应商). Add `vendors.phone` / `vendors.email` labels. Both files must keep identical key sets — `i18n-catalog.test.ts` enforces this.

- [ ] **Step 9: Verify no references remain and run the suite**

```bash
grep -rn "ontractor" apps/web/src apps/web/test
```

Expected: no output.

Run: `npx --workspace @mac-invoices/web vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npx prettier --write apps/web
git add apps/web
git commit -m "feat(web): rename contractors to vendors, serve /vendors with phone/email"
```

---

### Task 7: Vendor combobox on the invoice form

**Files:**
- Modify: `apps/web/src/components/InvoiceForm.tsx:74-82`
- Modify: `apps/web/test/InvoiceForm.test.tsx` (exists — reuse its render harness)
- Check: `apps/web/test/InvoiceNew.test.tsx` (may need a `useVendors` mock once the form fetches vendors)

**Interfaces:**
- Consumes: `useVendors()` from Task 6; `CreateInvoiceSchema.vendorId` from Task 5.
- Produces: the form now submits `vendorId?: string` alongside `vendorName`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('suggests saved vendors and sets vendorId when one is picked', async () => {
  const user = userEvent.setup()
  renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

  await user.type(screen.getByLabelText(/vendor/i), 'Ace')
  await user.click(await screen.findByRole('option', { name: 'Ace Plumbing' }))

  await submitForm(user)
  expect(submitted()).toMatchObject({ vendorName: 'Ace Plumbing', vendorId: 'v1' })
})

it('allows a name that matches no saved vendor and sends no vendorId', async () => {
  const user = userEvent.setup()
  renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

  await user.type(screen.getByLabelText(/vendor/i), 'Brand New Vendor')
  await submitForm(user)

  expect(submitted()).toMatchObject({ vendorName: 'Brand New Vendor' })
  expect(submitted().vendorId).toBeUndefined()
})

it('clears a previously picked vendorId when the name is edited', async () => {
  const user = userEvent.setup()
  renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

  await user.type(screen.getByLabelText(/vendor/i), 'Ace')
  await user.click(await screen.findByRole('option', { name: 'Ace Plumbing' }))
  await user.type(screen.getByLabelText(/vendor/i), ' Annex')

  await submitForm(user)
  expect(submitted().vendorId).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx --workspace @mac-invoices/web vitest run test/InvoiceForm.test.tsx`
Expected: FAIL — the vendor field is a plain input with no options.

- [ ] **Step 3: Implement the combobox**

Use a native `<datalist>` rather than pulling in a combobox dependency: it gives type-ahead plus free text for free, is keyboard- and screen-reader-accessible by default, and needs no extra bundle. Replace lines 74–82 of `apps/web/src/components/InvoiceForm.tsx`:

```tsx
<div>
  <label htmlFor="vendorName" className="block text-sm font-medium mb-1">
    {t('invoiceForm.vendor')}
  </label>
  <input
    id="vendorName"
    list="vendor-options"
    autoComplete="off"
    className={fieldClass}
    {...register('vendorName', {
      // Typing after a pick must drop the stale id, or the invoice would be
      // linked to a vendor whose name no longer matches what was typed.
      onChange: (e) => {
        const match = vendors.find((v) => v.name === e.target.value)
        setValue('vendorId', match?.id, { shouldDirty: true })
      },
    })}
  />
  <datalist id="vendor-options">
    {vendors.map((v) => (
      <option key={v.id} value={v.name} />
    ))}
  </datalist>
  {errors.vendorName && (
    <p className="mt-1 text-sm text-destructive">{errors.vendorName.message}</p>
  )}
</div>
```

Above the `return`, add:

```tsx
const { data: vendorData } = useVendors()
const vendors = vendorData?.data ?? []
```

with `import { useVendors } from '@/hooks/useVendors'`. Add `setValue` to the existing `useForm` destructure, and register the hidden field so it is submitted:

```tsx
<input type="hidden" {...register('vendorId')} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx --workspace @mac-invoices/web vitest run test/InvoiceForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/web
git add apps/web
git commit -m "feat(web): pick or create a vendor from the invoice form"
```

---

### Task 8: PDF Sender from the linked vendor

**Files:**
- Modify: `apps/web/src/lib/invoicePdf.ts:16-46,126-150,185-212`
- Modify: `apps/web/test/invoicePdf.test.ts`

**Interfaces:**
- Consumes: the `vendor` field flattened onto invoice list rows in Task 4.
- Produces: `PdfInvoiceInput.vendor: { name, phone, email } | null`; `InvoicePdfPage.sender: { name: string; lines: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('prefers the linked vendor over the invoice free text', () => {
  const [page] = buildInvoicePdfModel(
    [row({ vendorName: 'Typed Name', vendorEmail: 'typed@x.com',
           vendor: { name: 'Ace Plumbing', phone: '555-0100', email: 'ace@x.com' } })],
    new Map(),
    landlord,
  )
  expect(page.sender).toEqual({ name: 'Ace Plumbing', lines: ['ace@x.com', '555-0100'] })
})

it('skips a blank phone rather than emitting an empty line', () => {
  const [page] = buildInvoicePdfModel(
    [row({ vendor: { name: 'Ace', phone: null, email: 'ace@x.com' } })],
    new Map(),
    landlord,
  )
  expect(page.sender.lines).toEqual(['ace@x.com'])
})

it('emits a name-only sender when the vendor has no contact details', () => {
  const [page] = buildInvoicePdfModel(
    [row({ vendor: { name: 'Ace', phone: null, email: null } })],
    new Map(),
    landlord,
  )
  expect(page.sender.lines).toEqual([])
})

it('falls back to the invoice free text for a legacy unlinked invoice', () => {
  const [page] = buildInvoicePdfModel(
    [row({ vendorName: 'Legacy Co', vendorEmail: 'legacy@x.com', vendor: null })],
    new Map(),
    landlord,
  )
  expect(page.sender).toEqual({ name: 'Legacy Co', lines: ['legacy@x.com'] })
})

it('omits the contact line entirely when a legacy invoice has no vendor email', () => {
  const [page] = buildInvoicePdfModel(
    [row({ vendorName: 'Legacy Co', vendorEmail: null, vendor: null })],
    new Map(),
    landlord,
  )
  expect(page.sender.lines).toEqual([])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx --workspace @mac-invoices/web vitest run test/invoicePdf.test.ts`
Expected: FAIL — `sender` is `{ name, contact }` and reads `inv.contractor`.

- [ ] **Step 3: Update the types**

In `apps/web/src/lib/invoicePdf.ts`, replace the `contractor` field on `PdfInvoiceInput`:

```ts
  // The vendor this invoice is from, when it is linked to one — the PDF Sender
  // section. Null for a legacy invoice with no link, which falls back to
  // vendorName/vendorEmail (the closest "who this is from" data available).
  vendor: { name: string; phone: string | null; email: string | null } | null
```

and the `sender` field on `InvoicePdfPage`:

```ts
  // Variable-height: email and phone are each omitted when blank, so a vendor
  // with no contact details renders a name only rather than empty gaps.
  sender: { name: string; lines: string[] }
```

- [ ] **Step 4: Build the sender model**

Add above `buildInvoicePdfModel`:

```ts
/** Sender block: the linked vendor when there is one, else the invoice's own
 * free-text vendor fields. Blank contact lines are dropped, not rendered empty. */
function senderBlock(inv: PdfInvoiceInput): { name: string; lines: string[] } {
  if (inv.vendor) {
    return {
      name: inv.vendor.name,
      lines: [inv.vendor.email, inv.vendor.phone].filter((s): s is string => !!s),
    }
  }
  return { name: inv.vendorName, lines: [inv.vendorEmail].filter((s): s is string => !!s) }
}
```

and replace the `sender:` line inside the `.map()` with `sender: senderBlock(inv),`. Update the function's doc comment to say "vendor" instead of "submitting contractor".

- [ ] **Step 5: Render the variable-height block**

Replace the fixed two-line render and the table's `startY`:

```ts
    doc.setFont('helvetica', 'normal')
    doc.text(page.sender.name, MARGIN, senderY + 14)
    page.sender.lines.forEach((line, li) => {
      doc.text(line, MARGIN, senderY + 28 + li * 14)
    })
    doc.text(page.billTo.name, pageWidth / 2, senderY + 14)
    doc.text(page.billTo.email, pageWidth / 2, senderY + 28)

    // The sender block grows with its contact lines while Bill-To is always two
    // lines; start the table below whichever ran longer, or a three-line sender
    // would collide with it.
    const senderBottom = senderY + 14 + (1 + page.sender.lines.length) * 14
    const billToBottom = senderY + 42
    const tableStartY = Math.max(senderBottom, billToBottom) + 20
```

Then use `startY: tableStartY` in the `autoTable` call, and change the `finalY` fallback from `senderY + 88` to `tableStartY + 40`.

- [ ] **Step 6: Update the call site**

In `apps/web/src/pages/InvoiceList.tsx` (and `components/InvoiceTable.tsx` if it builds the same shape), pass `vendor: inv.vendor` where `contractor: inv.contractor` was passed.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx --workspace @mac-invoices/web vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx prettier --write apps/web
git add apps/web
git commit -m "feat(web): drive the PDF Sender block from the linked vendor"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`

- [ ] **Step 1: Update CLAUDE.md**

In the Database section, change the `Role` note to say `Role` includes `VENDOR`, and describe `Vendor` (table `vendors`, `name`/`phone`/`email`, submission link) plus `Invoice.vendorId` / `submittedByVendorId`.

- [ ] **Step 2: Add DEC-030 to docs/DECISIONS.md**

Follow the existing DEC-029 style — a bolded title line, the plan/spec paths, then lettered sub-decisions. Cover: (a) Vendor is a rename of Contractor, not a new entity, with the submission-link system retained; (b) `contact` split into nullable `phone`/`email` with the "at least one" rule in Zod rather than a SQL CHECK, because auto-create writes name-only vendors; (c) two separate FKs (`vendorId` for attribution, `submittedByVendorId` for provenance **and** the no-login authz scope) — collapsing them would let a vendor's link read landlord-entered invoices merely attributed to them; (d) auto-create runs server-side inside the invoice-write transaction, case-insensitive per landlord, and produces a vendor with `revokedAt` set so it has no usable link; (e) `InvoiceEvent.actorId` stored the literal `'contractor:'` prefix as data, so the migration rewrote those rows — renaming only the constant would have silently orphaned every historical event from the feed and digest; (f) the blob prefix `c_<id>` was deliberately NOT renamed, because it is embedded in the storage keys of already-uploaded images; (g) `/contractors` redirects to `/vendors`, and `/submit/:token` is unchanged so links already issued keep working.

- [ ] **Step 3: Note the migration in docs/DEPLOYMENT.md**

Add a step recording that `20260807190000_rename_contractor_to_vendor` must be applied to production, that it is data-preserving (`RENAME`, never DROP+CREATE), and that it rewrites `invoice_events.actorId` prefixes. Flag that the API and web deploy must go out together — the renamed API routes and the renamed columns land in the same migration.

**Also add a required pre-deploy audit.** Both local databases had zero `contractors` rows, so the `contact` → `phone`/`email` backfill was proved only against a scratch table of boundary cases — never against real data. Production is the first place it meets real rows. Before migrating, run this read-only query against production and eyeball the routing:

```sql
SELECT name, contact,
       CASE WHEN contact LIKE '%_@_%.__%' THEN 'email' ELSE 'phone' END AS routes_to
FROM contractors ORDER BY name;
```

No row can be lost — the predicate and its complement are exhaustive, and the value is copied verbatim either way. What the audit catches is *misfiling*: an address without a dot in the domain (`bob@localhost`) routes to `phone`, and a phone number written as `555@home.com` would route to `email`. Anything misfiled is corrected with a one-line `UPDATE` after the migration; it is not a reason to block the deploy.

- [ ] **Step 4: Run the full Definition of Done**

```bash
npm run lint && npm run typecheck && npm run test
```

Expected: all green. Re-run any single failing api file alone before treating it as a regression.

- [ ] **Step 5: Confirm no stray references remain**

```bash
grep -rni "contractor" apps packages --include="*.ts" --include="*.tsx" --include="*.prisma" --include="*.json" | grep -v node_modules | grep -v generated
```

Expected: no output. (`docs/plans/` and `docs/brainstorms/` are excluded by design — historical records keep their original wording.)

- [ ] **Step 6: Commit**

```bash
npx prettier --write CLAUDE.md docs
git add CLAUDE.md docs
git commit -m "docs: record the Contractor to Vendor rename (DEC-030)"
```

---

## Self-Review Notes

**Spec coverage:** D1 → Tasks 2–6. D2 → Tasks 1, 2, 3, 6. D3 → Task 2. D4 → Tasks 5, 7. D5 → Task 8. D6 → Task 6 Step 6. D7 → Task 9 Step 5 (grep deliberately scoped to `apps`/`packages`). All six spec test requirements map to Task 1 Step 2, Task 3 Step 2, Task 4 Step 1, Task 5 Step 1, and Task 8 Step 1; the spec's seventh (notifications surface pre-rename events) is covered by the existing `notifications.feed`/`digest` suites passing in Task 4 Step 6 against the migrated local database.

**Known risk:** auto-created vendors are born with `revokedAt` set, so the `/vendors` page will list them with an inactive link. This is intended — the landlord regenerates a link when they actually want the vendor to self-submit.
