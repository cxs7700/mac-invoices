---
date: 2026-06-25
topic: properties
---

# Properties — requirements

## Summary

Make a landlord's rental properties a first-class, per-landlord entity so invoices (and spend) can be organized by property. The "Properties" nav stub becomes a live list + create/edit/delete page; invoices gain a property selector and a property filter; each property gets a detail page with its invoices and a total-spend rollup. A property is optional on a draft or contractor submission but required to approve an invoice.

## Problem Frame

A landlord manages several properties, but invoices today have no real property dimension — `Invoice.propertyId` exists as a nullable column with nothing behind it, so every invoice is effectively unassigned and spend can't be grouped by property. The landlord can see totals by status and category (the Dashboard) but cannot answer "how much have I spent on this property?" — the question that maps to how rental costs are actually budgeted and reconciled.

## Key Decisions

- **Required on approval, not at create.** Property stays optional at create and on contractor submission (the contractor doesn't know it), but the `APPROVED` transition is blocked until a property is set — mirroring how `category` already works. This guarantees every approved invoice is attributed without breaking the submission flow.
- **Block delete over null-on-delete.** Deleting a property is refused while any invoice references it (the landlord reassigns first), rather than clearing those invoices' property (the Contractor `SetNull` precedent). This protects the per-property spend history an approved invoice would otherwise silently lose.
- **Lean free-text fields.** A property is a name/label, a single free-text address, and optional notes — enough for a landlord with a handful of properties. Structured address, property type, and an archive status are deferred.
- **Mirror the Contractor vertical slice.** Reuse the established per-landlord pattern (Prisma model → ownership-scoped routes/handlers → shared schemas → web hook + page → nav-stub-to-live-route). Properties is net-new data but a well-trodden shape.
- **Spend rollup excludes rejected and cancelled.** The property total counts every attached invoice except `REJECTED` and `CANCELLED`, which aren't real spend.

## Requirements

**Property entity & management**

- R1. A Property is a per-landlord entity with a name/label, a free-text address, and optional notes. Every read and write is scoped to the owning landlord — no cross-landlord access.
- R2. The landlord can create, edit, list, and delete properties from a Properties page, and the "Properties" nav item becomes a live route.
- R3. Deleting a property is blocked while any invoice references it; the landlord must reassign those invoices to another property (or clear them) first.

**Invoice ↔ Property**

- R4. An invoice references at most one property, and both must belong to the same landlord. The existing nullable `propertyId` becomes a real foreign key to the Property entity.
- R5. A property is optional at create and on contractor submission, and required to move an invoice to `APPROVED` — the approval is blocked until a property is set.
- R6. The invoice create/edit form offers a property selector listing the landlord's properties; the field is optional there. Contractor submissions carry no property.
- R7. Existing invoices remain unassigned (`propertyId` null); no backfill is performed.

**Filtering & spend**

- R8. The invoice list can be filtered by property, including an "Unassigned" option that returns only property-less invoices.
- R9. Each property has a detail page that lists its invoices and shows a total-spend rollup — the sum of its invoices' amounts excluding `REJECTED` and `CANCELLED`.

## Key Flows

- F1. Assign and approve
  - **Trigger:** Landlord creates or edits an invoice.
  - **Steps:** They optionally pick a property from the selector and save. On approving the invoice, if no property is set the transition is blocked with a clear reason; once a property is set, approval proceeds.
  - **Covered by:** R5, R6
- F2. Delete a property
  - **Trigger:** Landlord deletes a property.
  - **Steps:** If invoices reference it, the delete is refused and the landlord is told how many are attached. They reassign those invoices to another property, then the delete succeeds.
  - **Covered by:** R3
- F3. View property spend
  - **Trigger:** Landlord opens a property's detail page.
  - **Steps:** They see the property's invoices and its total-spend rollup (rejected/cancelled excluded).
  - **Covered by:** R9

## Acceptance Examples

- AE1. **Covers R5.** An invoice with no property cannot be approved: the `APPROVED` transition is refused with a clear "property required" reason. After the landlord sets a property, the same approval succeeds.
- AE2. **Covers R3.** Deleting a property with two attached invoices is refused. After both invoices are reassigned to another property, deleting the now-empty property succeeds.
- AE3. **Covers R9.** A property with a `PAID` $100 invoice, an `APPROVED` $50 invoice, and a `REJECTED` $30 invoice shows a total-spend rollup of $150 (the rejected invoice is excluded).
- AE4. **Covers R8.** Filtering the invoice list by a specific property returns only that property's invoices; filtering by "Unassigned" returns only invoices with no property.

## Scope Boundaries

Deferred for later:

- Dashboard per-property spend bars/breakdown (extends the existing `SpendBars`/stats).
- Contractor ↔ property association or scoping.
- Structured address fields, property type (residential/commercial), and multi-unit support.
- An active/archived property status.
- i18n of the Properties UI — it stays English, consistent with the rest of the app; the EN/ZH effort is a separate phase.

## Dependencies / Assumptions

- `Invoice.propertyId String?` already exists (nullable, no FK/relation); this work adds the `Property` entity and promotes that column to a foreign key.
- Mirrors the existing Contractor entity and the nav-stub-to-live-route conversion already done for the Contractors page.
- The migration is backward-compatible (a new table plus a foreign key on an already-nullable column); applying it to the hosted DB via `db:deploy` is the manual ship step. The app is not yet deployed to production, so there is no production backfill concern.
- Single landlord today; ownership scoping (DEC-019) and Postgres as the source of truth (DEC-001) hold. No new paid dependencies.

## Outstanding Questions

Deferred to Planning:

- The mechanism for blocking a referenced property's deletion (a database `RESTRICT` versus an app-level pre-check returning a friendly conflict) — planning decides.
- Exactly where required-on-approval is enforced (the same validation path that already requires `category` on approval).
- Whether the property selector and the list filter need typeahead/search, or a plain dropdown suffices at this scale.
