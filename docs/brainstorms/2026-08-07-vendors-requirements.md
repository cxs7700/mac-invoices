# Vendors — requirements

**Date:** 2026-08-07
**Status:** approved, ready for planning
**Branch:** `worktree-vendors`

## Summary

Rename the existing `Contractor` concept to **Vendor** across the application and
the database, split its single free-text `contact` field into separate **phone**
and **email** fields, expose vendor management at `/vendors`, let the invoice form
pick (and implicitly create) vendors, and drive the generated PDF's Sender block
from the linked vendor record.

This is predominantly a rename plus a field split. The submission-link system
(no-login tokenized invoice submission) is retained unchanged apart from naming.

## Background

The codebase already models this entity as `Contractor`:

- Prisma model `Contractor` → table `contractors`, fields `name` + `contact`
  (one required free-text field holding a phone *or* an email, landlord's choice).
- API module `apps/api/src/contractors/` (handlers, routes, token).
- Web page `apps/web/src/pages/Contractors.tsx` at `/contractors`.
- `Role.CONTRACTOR` on `User`.
- `Invoice.submittedByContractorId` — set when the invoice arrived through a
  contractor's submission link; also used as the **authorization scope** for the
  link-holder's own reads/writes (`apps/api/src/submissions/handlers.ts`).
- The PDF already renders a Sender block resolving to
  `inv.contractor ?? { name: vendorName, contact: vendorEmail }` (DEC-028(c)).

`Invoice.vendorName` / `vendorEmail` are unrelated free-text columns and already
use the word "vendor". After this change the two meanings converge, which is the
point: the vendor named on an invoice becomes a real record.

## Decisions

| # | Decision |
|---|---|
| D1 | `Vendor` is a **rename** of `Contractor`, not a new entity. Submission links stay. |
| D2 | `contact` splits into nullable `phone` + `email`; Zod requires **at least one**. |
| D3 | Rename goes all the way into the **physical database** (table, column, enum value). |
| D4 | Invoice form gets a combobox; an unknown typed name **auto-creates** a vendor. |
| D5 | PDF Sender resolves from the linked vendor: name / email / phone, blanks skipped. |
| D6 | `/contractors` **redirects** to `/vendors`. |
| D7 | Historical docs under `docs/plans/` and `docs/brainstorms/` keep their original wording. |

## Data model

### `Contractor` → `Vendor` (table `contractors` → `vendors`)

| Field | Change |
|---|---|
| `name` | unchanged — required, max 100 (bounded by `Invoice.vendorName`) |
| `contact` | **removed**, split into `phone` and `email` |
| `phone` | **new** — `String?`, max 50 |
| `email` | **new** — `String?`, max 200, email-validated |

Both new columns are nullable at the database level. The "at least one of phone
or email" rule is enforced in Zod at the API boundary rather than as a SQL CHECK
constraint, because the auto-create path (D4) intentionally writes a vendor with
neither.

Everything else on the model — `lookupId`, the token hash, `linkActive`,
`lastUsedAt`, `landlordId` — is unchanged.

### `Invoice`

- **New** `vendorId String?` with `onDelete: SetNull` — "this invoice is from this
  vendor." Set by the picker or by auto-create.
- `submittedByContractorId` → `submittedByVendorId`, **kept as a separate column**.

Keeping two FKs to `vendors` is deliberate. `submittedByVendorId` is an
authorization boundary: `apps/api/src/submissions/handlers.ts` scopes a
link-holder's queries with `where: { submittedByVendorId }`. If attribution and
provenance shared one column, a landlord-entered invoice merely *attributed* to a
vendor would become readable and editable through that vendor's submission link —
a privilege escalation. Two columns, two meanings:

- `vendorId` — who the invoice is from (attribution, drives the PDF Sender).
- `submittedByVendorId` — this vendor self-submitted it (provenance + authz).

A self-submission sets both to the same vendor.

`vendorName` stays on `Invoice` as a denormalized snapshot, so a historical
invoice keeps the name it was issued under even if the vendor is later renamed or
deleted.

### Enum

`Role.CONTRACTOR` → `Role.VENDOR`, via `ALTER TYPE ... RENAME VALUE`.

## Migration

One Prisma migration, data-preserving, in this order:

1. `ALTER TABLE contractors RENAME TO vendors` (plus index/constraint renames).
2. Add `phone` and `email` columns.
3. Backfill: `email = contact` where `contact` matches an email pattern
   (`contact LIKE '%_@_%.__%'`), otherwise `phone = contact`.
4. Drop `contact`.
5. `ALTER TABLE invoices RENAME COLUMN "submittedByContractorId" TO "submittedByVendorId"`.
6. Add `invoices.vendorId` + FK + index.
7. `ALTER TYPE "Role" RENAME VALUE 'CONTRACTOR' TO 'VENDOR'`.
8. `UPDATE invoice_events SET "actorId" = 'vendor:' || substring("actorId" from 12)
   WHERE "actorId" LIKE 'contractor:%'` — see below.

### `InvoiceEvent.actorId` is stored data, not just a constant

`apps/api/src/notifications/{feed,digest}.ts` both define
`const CONTRACTOR = 'contractor:'` and use it as a **persisted value prefix**:
events are written with `actorId = 'contractor:' + id` and read back with
`actorId: { startsWith: 'contractor:' }`.

Renaming only the TypeScript constant would silently orphan every existing event
row — the notifications feed and the digest email would stop matching any
historical vendor activity, with no error. Step 8 migrates the stored rows in the
same migration that renames the constant to `VENDOR = 'vendor:'`, keeping code and
data in step.

`Role.CONTRACTOR` itself is not referenced anywhere in application code (vendors
are not `User`s), so renaming the enum value is safe on its own.

Renames use `RENAME`, never drop-and-recreate, so no row is lost. This is the
only irreversible step in the feature and is applied against the local docker
Postgres first; production application follows `docs/DEPLOYMENT.md`.

## API

- `apps/api/src/contractors/` → `apps/api/src/vendors/`.
- Routes `/api/contractors*` → `/api/vendors*`. No compatibility alias — the API
  is consumed only by this app's own frontend.
- `CreateContractorSchema` → `CreateVendorSchema`, taking `name`, `phone?`,
  `email?`, with a `.refine()` requiring at least one of phone/email.
- `ContractorSchema` → `VendorSchema`, exposing `phone`/`email` in place of
  `contact`. It still never returns the token secret or hash.
- The public submission path `/submit/:token` and its token semantics are
  **unchanged**, so links already issued keep working.

### Auto-create on invoice write

On `POST /api/invoices` and `PATCH /api/invoices/:id`: if `vendorName` is
non-empty and `vendorId` is null, look up a vendor for the session user by
case-insensitive name; create one (name only, no phone/email, no submission link)
if absent; link it.

This runs **server-side inside the existing invoice-write transaction**, not in
the browser. A client-side "create vendor, then create invoice" pair would let a
double-submit or a partial failure create duplicate or orphaned vendors.

## Frontend

- `pages/Contractors.tsx` → `pages/Vendors.tsx`, mounted at `/vendors`;
  `/contractors` redirects.
- `components/ContractorLinkCard.tsx` → `VendorLinkCard.tsx`.
- `hooks/useContractors.ts` → `hooks/useVendors.ts`.
- `pages/ContractorSubmit.tsx` → `VendorSubmit.tsx` (route `/submit/:token` unchanged).
- `NavLinks.tsx` entry `contractors` → `vendors`.
- The add/edit form replaces the single Contact input with **Phone** and **Email**
  inputs, showing a validation error when both are empty.
- `InvoiceForm.tsx`: the `vendorName` text input becomes a combobox backed by
  `GET /api/vendors`. Selecting sets `vendorId` and mirrors the name into
  `vendorName`; free typing leaves `vendorId` null.
- Both locale catalogues (`en`, `zh`) get their `contractor*` keys renamed to
  `vendor*` and their user-facing strings updated. `i18n-catalog.test.ts` already
  guards key parity between the two.

## PDF

`apps/web/src/lib/invoicePdf.ts` Sender precedence becomes:

1. The invoice's linked **vendor** (`vendorId`) → `name`, `email`, `phone`.
2. Fall back to `vendorName` + `vendorEmail` for legacy invoices with no link.

The Sender block becomes variable-height: name, then email, then phone, omitting
whichever is blank so no empty gaps appear. Because the block sits above the items
table, the table's `startY` must be **computed from the rendered line count**
rather than the current fixed `senderY + 48` — otherwise a three-line sender
overlaps the table. Bill-To remains the landlord on every page (DEC-028(c)),
unchanged.

## Testing

Renamed suites keep their existing coverage: `contractors.crud`,
`contractors.schema`, `contractors.token`, `submissions.*`, `Contractors.test.tsx`,
`ContractorSubmit.test.tsx`, `packages/shared/test/contractor.test.ts`.

New coverage:

1. Migration backfill routes an email-shaped `contact` to `email` and anything
   else to `phone`.
2. `CreateVendorSchema` rejects a vendor with neither phone nor email, accepts
   either alone.
3. Auto-create is idempotent — two invoices naming the same vendor (differing in
   case) yield one vendor row, not two.
4. Auto-create does **not** issue a submission link, and the created vendor has
   `linkActive: false`.
5. **Authz regression:** a submission-link holder still cannot read or edit an
   invoice that merely has their `vendorId` set but a different (or null)
   `submittedByVendorId`.
6. `invoicePdf` sender precedence (linked vendor beats free text) and blank-skipping
   line math, including that the items table starts below a three-line sender.
7. The notifications feed and digest still surface events written **before** the
   rename, proving the `actorId` prefix migration (step 8) took effect.

## Definition of Done

`npm run lint && npm run typecheck && npm run test` all green.

Note: the `apps/api` suite has a pre-existing intermittent failure (~1 run in 3)
caused by a race on the shared landlord row across parallel test files. It is
unrelated to this work; re-run to confirm rather than treating it as a regression.

## Out of scope

- Sending SMS or email to vendors (the phone/email fields are display + PDF only).
- Merging or de-duplicating vendors created by the auto-create path.
- Per-vendor spend reporting.
- Rewriting historical design docs to say "vendor" (D7).

## Open questions

None.
