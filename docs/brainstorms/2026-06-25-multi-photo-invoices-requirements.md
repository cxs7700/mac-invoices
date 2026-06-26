---
date: 2026-06-25
topic: multi-photo-invoices
---

# Multi-photo invoices (cash / parts / check) — requirements

## Summary

Let an invoice hold up to five typed photos (cash / parts / check / other) instead of a single attachment. The landlord and contractors can both add multiple photos — a contractor submission still requires at least one, while a landlord can create an invoice with none and add photos later. The landlord manages photos in a gallery (view, add, remove, re-type). Any active invoice with zero photos surfaces an "add a photo" actionable indicator on the invoice list and detail page.

## Problem Frame

The data model already supports multiple typed photos per invoice, but the API and UI are effectively single-image: one attachment, no types, no gallery. Real invoices come with several receipts of different kinds (cash receipt, parts slip, the check), and sometimes no photo is on hand when the invoice is first recorded — today that either forces a placeholder or blocks capture. There's also no signal that an image-less invoice is waiting for a photo, so they quietly go un-documented.

## Actors

- A1. **Landlord** — records invoices; manages the full photo gallery (add/remove/re-type) on their own invoices.
- A2. **Contractor** — submits invoices via the public link; uploads one or more photos (at least one) but does not curate types after the fact.

## Key Decisions

- **`images[]` is the single source of truth.** The legacy single `Invoice.attachmentUrl` is folded into the photo set, so the "has photos?" check, the gallery, and the Sheets export all read one place. An invoice that has only a legacy attachment counts as having one photo.
- **Type is optional at upload, editable later.** Every photo defaults to `Other`; whoever uploads may pick a type, and the landlord can change any photo's type from the gallery. Frictionless capture (especially on the contractor mobile flow) is favored over forcing a tag at upload. Multiple photos of the same type are allowed.
- **Asymmetric requirement.** A contractor submission requires ≥1 photo (the proof); a landlord-created invoice may have zero. The cap is 5 photos per invoice, to keep payloads and memory bounded.
- **The indicator means "action available," not decoration.** It only appears where adding a photo is a sensible next step — active invoices with no photos — and links to the add-photo flow.

## Requirements

**Photos on an invoice**

- R1. An invoice holds 0–5 photos; each photo has a type of cash, parts, check, or other (default other).
- R2. The photo set is the single source of truth; a legacy `attachmentUrl` is treated as one photo in that set (no data is stranded).
- R3. The landlord can add, view full-size, remove, and change the type of any photo on their own invoices, in a gallery.
- R4. Multiple photos of the same type are allowed.

**Creation & requirement rules**

- R5. A landlord can create an invoice with zero photos and add them later.
- R6. A contractor submission requires at least one photo and accepts up to the cap.
- R7. An invoice may have at most 5 photos; the limit is enforced server-side and the UI prevents exceeding it.

**Actionable indicator**

- R8. An active invoice (PENDING / APPROVED / PAID) with zero photos shows an "add a photo" actionable indicator on both the invoice list and the invoice detail page. Terminal invoices (REJECTED / CANCELLED) and any invoice with ≥1 photo show nothing.
- R9. The indicator is an affordance that leads to adding a photo, not a passive label.

**Cross-cutting**

- R10. Photo actions are ownership-scoped (a landlord only on their own invoices; a contractor only on their own submission), photo reads use signed URLs via the storage seam, and all new UI strings are bilingual (EN/ZH).

## Key Flows

- F1. Create now, photograph later
  - **Trigger:** Landlord creates an invoice without a photo.
  - **Steps:** The invoice saves; it appears in the list with the "add a photo" indicator; later the landlord opens it and adds one or more photos; the indicator clears.
  - **Covers:** R5, R8
- F2. Manage the gallery
  - **Trigger:** Landlord opens an invoice's photos.
  - **Steps:** They view photos full-size, add up to the cap, remove any, and change a photo's type; changes persist.
  - **Covers:** R3, R4, R7
- F3. Contractor multi-photo submission
  - **Trigger:** Contractor submits via their link.
  - **Steps:** They attach at least one photo (optionally typed) and up to the cap, then submit; the photos appear on the resulting invoice.
  - **Covers:** R6

## Acceptance Examples

- AE1. **Covers R7.** Adding a 6th photo to an invoice that already has 5 is rejected (server 422), and the UI disables further uploads at 5.
- AE2. **Covers R6.** A contractor submission with zero photos is rejected; one with 1–5 photos succeeds.
- AE3. **Covers R8.** A PAID invoice with no photos shows the indicator; a CANCELLED invoice with no photos does not; an invoice with at least one photo does not.
- AE4. **Covers R2.** An invoice that has only a legacy `attachmentUrl` displays that image in the gallery and shows no indicator.
- AE5. **Covers R1, R3.** A photo uploaded as Other can be re-typed to Cash from the gallery, and the new type persists.

## Scope Boundaries

Deferred for later:

- Photo captions (the model has a caption field; leave it unused for v1).
- Reordering photos and choosing a "primary" photo.
- In-app image editing/cropping and OCR/data extraction from photos.
- Contractor-side re-typing or gallery management after submission (contractors add photos; the landlord curates types).
- Per-type requirements (e.g., "a check photo is required").

## Dependencies / Assumptions

- The `InvoiceImage` model and `ImageType` enum already exist; no new entity is needed. Any change to retire `attachmentUrl` is a backward-compatible migration applied via the manual `db:deploy` step. The app is not yet deployed to production, so there is no production backfill concern.
- Reuses the existing storage integration seam (presigned upload token, signed read URLs, error sanitization) — no new paid dependency.
- Single landlord today; ownership scoping (DEC-019) and Postgres as source of truth (DEC-001) hold.

## Outstanding Questions

Deferred to Planning:

- The mechanism for folding `attachmentUrl` into the photo set: a one-time backfill into image rows, read-time coalescing, or keeping the column but always presenting it as a photo. Planning decides.
- The exact visual of the "add a photo" indicator (badge/pill/icon + call-to-action) on the list row vs the detail page.
- Whether the landlord removing the last photo of a contractor submission is allowed post-review (the ≥1 rule is a submit-time gate; after that the landlord manages freely, and an active image-less invoice would then show the indicator).
