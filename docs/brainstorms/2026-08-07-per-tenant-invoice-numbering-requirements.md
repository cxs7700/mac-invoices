---
date: 2026-08-07
topic: per-tenant-invoice-numbering
---

# Per-Tenant Invoice Numbering — Requirements

## Summary

Make invoice numbers unique and sequential **per landlord** instead of globally. `invoiceNumber` loses its global `@unique` and gains a composite `@@unique([userId, invoiceNumber])`; the next-number scan is scoped to the owner. No invoice number is rewritten — existing rows already satisfy the new constraint, and the current landlord's sequence continues unbroken. This closes DEC-029(j), the recorded blocker on enabling signup for real multi-tenant use.

---

## Problem Frame

Invoice numbering was written when the app had exactly one landlord, and it still assumes that. `nextInvoiceNumber()` (`apps/api/src/invoices/writeService.ts:171`) scans **every** invoice in the table — `findMany({ select: { invoiceNumber: true } })` with no `userId` filter — parses each value, and returns the global maximum plus one. `apps/api/prisma/schema.prisma:86` declares `invoiceNumber String? @unique`, globally.

Invite-gated signup (DEC-029) made a second tenant possible, which turns both of those into cross-tenant defects:

- **Disclosure.** A newly signed-up landlord's very first invoice is numbered *global max + 1*. If the incumbent has 437 invoices, the new tenant's first invoice is `#438` — it silently reports how much business another user has done.
- **Existence oracle.** Because the unique constraint spans all tenants, a client-supplied `invoiceNumber` that collides with **another tenant's** invoice returns 409 (`apps/api/src/invoices/handlers.ts:41`). That is a working probe for whether an arbitrary invoice number exists in someone else's ledger.

Both were found by the final review of the signup work and deliberately deferred, because closing them needs a schema migration against the live hosted database. They are latent rather than live only because `SIGNUP_INVITE_CODE` is currently unset everywhere.

A related, smaller problem disappears with the same change: the unscoped scan loads every invoice number in the table into memory on every create, which grows without bound and is already unnecessary work.

---

## Key Decisions

- **Existing numbers are never rewritten.** The current landlord's invoices keep the numbers they have, and their next invoice continues the same sequence it would have today. Rejected: renumbering every tenant from 1 — those numbers already appear in exported PDFs, in the mirrored Google Sheet, and potentially in documents handed to third parties, so rewriting them would invalidate records outside the system.
- **New tenants start at 1.** With the scan scoped by owner, a landlord with no numbered invoices yields max 0, so their first number is `1`. This falls out of the scoping rather than needing its own logic.
- **No per-tenant prefix.** Rejected: giving each tenant a short prefix (`AB-1`, `CD-1`) so numbers are globally distinguishable. It would need a new `User` field, and it would either change the incumbent's existing numbers or leave their old and new invoices inconsistent with each other. Numbers are only ever displayed within one landlord's own context, so global distinguishability buys nothing today.
- **The constraint becomes composite, not merely the scan.** Scoping only the scan would leave the cross-tenant 409 oracle in place. Both halves are required for R2.
- **Multiple unnumbered invoices per tenant must keep working.** `invoiceNumber` is nullable because contractor submissions are unnumbered until approved. Postgres treats NULLs as never equal, so a composite unique index permits many NULL rows per user, exactly as the current global index does. This is relied upon, not incidental.
- **The next-number scan stays an in-memory parse, not a DB-side `max()`.** The column is `String?`, so a SQL `MAX()` would be lexicographic (`"9" > "10"`) and wrong. Scoping already bounds the row set to one tenant.
- **Migration runs before the code that depends on it**, per `docs/DEPLOYMENT.md` §3. This ordering is safe here: in the window between migration and deploy, the old code's global scan still produces a number that satisfies the composite constraint, and same-tenant duplicates still 409. The only behavior the migration alone unlocks is cross-tenant number reuse, which is the intended end state.
- **The migration is hand-authored SQL applied with `prisma migrate deploy`**, following the repo's established practice, rather than `prisma migrate dev` (which spins up a Prisma Dev server that has been unreliable in this project).

---

## Requirements

- R1. Invoice numbers are sequential per landlord: a landlord's next number is one greater than their own highest existing number, independent of every other landlord's invoices.
- R2. A landlord can create or edit an invoice carrying a number that another landlord already uses, without conflict — no error, and no signal that the number exists elsewhere.
- R3. A landlord still cannot hold two invoices with the same number; that attempt fails as it does today.
- R4. A landlord may hold any number of unnumbered invoices simultaneously, as contractor submissions require.
- R5. No existing invoice number changes as a result of this work, in the database or in any export.
- R6. A landlord with no numbered invoices gets `1` for their first one.
- R7. Numbers assigned when a contractor submission is approved follow the same per-landlord rule as numbers assigned at creation.
- R8. The seed remains runnable and idempotent, re-importing the landlord's CSV invoices without duplicating them.

---

## Key Flows

- F1. Creating an invoice with no number supplied
  - **Trigger:** A landlord creates an invoice and does not specify a number.
  - **Steps:** The owner's highest existing number is determined, and the next one is assigned within the same transaction that inserts the row.
  - **Covers:** R1, R6.
- F2. Approving a contractor submission
  - **Trigger:** A landlord approves a submission that has no number yet.
  - **Steps:** The invoice is stamped with the owner's next number on the transition.
  - **Covers:** R7.
- F3. Supplying a number explicitly
  - **Trigger:** A landlord creates or edits an invoice with a number they choose.
  - **Steps:** It is accepted unless that landlord already uses it; another landlord using it is irrelevant and invisible.
  - **Covers:** R2, R3.

---

## Acceptance Examples

- AE1. **Covers R1, R6.** Given landlord A has invoices numbered up to 437 and landlord B has none, when B creates their first invoice, its number is `1`.
- AE2. **Covers R1.** Given landlord A's highest number is 437, when A creates an invoice, its number is `438` regardless of how many invoices B has created since.
- AE3. **Covers R2.** Given landlord A holds invoice `12`, when landlord B creates an invoice explicitly numbered `12`, it succeeds and B observes nothing about A.
- AE4. **Covers R3.** Given landlord A holds invoice `12`, when A tries to create another invoice numbered `12`, it fails with a conflict.
- AE5. **Covers R4.** Given landlord A has three unapproved contractor submissions, all three coexist with no number, and a fourth can be submitted.
- AE6. **Covers R5.** Given the migration has been applied, when the landlord's invoice list and exported sheet are inspected, every previously existing invoice shows the number it had before.
- AE7. **Covers R7.** Given landlord B has one invoice numbered `1`, when B approves a contractor submission, that submission becomes `2`.
- AE8. **Covers R8.** Given the seed has already run, when it is run again, no invoice is duplicated and it completes without error.

---

## Scope Boundaries

Deferred or explicitly excluded:

- **Per-tenant prefixes or any change to number format** — plain integers, as today.
- **Renumbering or backfilling existing invoices** — explicitly rejected above.
- **Making invoice numbers unguessable** — they remain small sequential integers. Within a tenant that is intended; this work removes only the *cross-tenant* leak.
- **Gapless numbering guarantees** — gaps already occur (a number is assigned on approval, and a later deletion leaves a hole). Unchanged.
- **The remaining multi-tenant items from DEC-029** — password reset, email verification, and per-user Google OAuth are separate work.
- **The pre-existing api-suite parallelism flake** — unrelated; tracked separately.

---

## Dependencies / Assumptions

- The two call sites that assign numbers (`writeService.ts:248` for create, `:485` for the APPROVED transition) both already have the owning user's id available, so scoping needs no new plumbing (verified).
- **`apps/api/prisma/seed.ts:117` uses `where: { invoiceNumber }` as a Prisma unique selector.** Dropping the global `@unique` removes `invoiceNumber` from the generated unique-where type, so this stops typechecking and must move to the composite key. This is the only such usage in the codebase (verified by search).
- Every existing invoice number is currently globally unique, so the composite constraint is satisfied by existing data without any cleanup step.
- The existing auto-number retry in the create handler already tolerates a P2002 on the number by reopening the transaction; scoping the scan does not change that behavior.
- Applying the migration to the hosted database is an operator step the human performs when deploying; this work authors and locally verifies it.
- Local verification runs against the docker Postgres on port 5433, never the hosted database named by the root `.env`.

---

## Outstanding Questions

Deferred to planning:

- Whether the composite unique index should also serve as a query index (`(userId, invoiceNumber)` ordering) or whether an existing index already covers the scan's access pattern.
- Whether the scoped scan should select only non-null numbers at the database level rather than filtering nulls in memory.

---

## Sources / Research

- `docs/DECISIONS.md` DEC-029(j) — records this defect, its two file locations, and the sketched fix; this spec is that item being taken up.
- `apps/api/src/invoices/writeService.ts:171` (`nextInvoiceNumber`), `:248` and `:485` (its call sites) — the current numbering implementation.
- `apps/api/prisma/schema.prisma:86` — the global `@unique` being replaced.
- `apps/api/src/invoices/handlers.ts:41` — the client-supplied-number path that currently produces the cross-tenant 409.
- `apps/api/prisma/seed.ts:117` — the unique-selector usage that must change with the constraint.
- `docs/DEPLOYMENT.md` §3 — the migrate-before-deploy rule this follows.
