---
date: 2026-08-09
topic: sheet-target-uniqueness
---

# Sheet Target Uniqueness — Requirements

## Summary

Stop two landlord accounts from connecting the same Google spreadsheet. Today
`PATCH /api/settings/sheets` saves whatever string it is given, and
`User.sheetSpreadsheetId` carries no constraint — so two tenants can point at
one sheet, and because the mirror is clear-and-rewrite, whichever syncs second
silently erases the other's ledger. The fix is a unique index, a 409 translated
from the resulting constraint violation, and normalization of the saved value so
a pasted URL and a bare id cannot become two rows naming one sheet.

---

## Problem Frame

`saveSheet` (`apps/api/src/settings/handlers.ts:140-147`) writes
`sheetSpreadsheetId` with no uniqueness or ownership check, and the column is a
plain nullable `String` (`apps/api/prisma/schema.prisma:28`). Nothing anywhere
in the write path looks at what other accounts have claimed.

The consequence is not a merge or a conflict — it is data loss.
`mirrorUserSheet` (`apps/api/src/invoices/sheetSync.ts:74-111`) clears the tab
and rewrites it from one user's invoices (DEC-001). Two users sharing a target
means each sync replaces the other's rows wholesale. The cron isolates failures
per user, but this path never fails: from the job's perspective both mirrors
succeeded. The victim's only signal is that their spreadsheet now contains
someone else's invoices.

This was demonstrated live with two test accounts pointing at one sheet before
they were deleted. It is reachable in production now that invite-gated signup is
live (DEC-029): any invitee who learns another landlord's spreadsheet id can
claim it.

**Ownership cannot be verified, and this is the crux.** The integration works by
the landlord sharing their sheet with the service account as an Editor — so the
service account holds write access to *every* connected sheet by design.
`checkAccess` will happily confirm reachability of a spreadsheet belonging to
someone else, because it genuinely is reachable. Google cannot tell us who
should own it. Our own uniqueness bookkeeping is therefore not defense in depth
layered over a real check; it is the only thing standing between one tenant and
another's data.

A uniqueness constraint alone is also not enough. `SaveSheetSchema` currently
accepts any string of 1–200 characters
(`packages/shared/src/schemas/settings.ts:53-55`), while the Settings field is
merely *labelled* "Target spreadsheet ID". A landlord who pastes
`https://docs.google.com/spreadsheets/d/<id>/edit#gid=0` and one who types
`<id>` name the same sheet with different strings — a constraint compares
strings and waves both through. Pasting the URL is the more natural action of
the two, so this is the likely path, not the exotic one. Normalization is what
makes the constraint mean what it says.

---

## Key Decisions

- **The database adjudicates.** A unique index on `User.sheetSpreadsheetId` is
  the authority; the handler's job is only to translate the violation into a
  good message.
- **No pre-flight read.** Rejected: `findFirst` to see whether the id is taken,
  then write. Two concurrent saves both read "free" and both write — exactly
  the race the constraint exists to stop. Catching P2002 gets the same message
  with no race and one fewer query. Also rejected: doing both, since the
  pre-check earns nothing once the constraint yields the same message.
- **Postgres treats NULLs as distinct**, so a plain unique index permits any
  number of unconnected landlords. A partial `WHERE ... IS NOT NULL` index would
  be a marginal size optimization on a table of this size and is not worth the
  hand-written divergence from what Prisma's `@unique` generates.
- **The collision message names the situation explicitly** — "already connected
  to another account" — accepting that someone probing ids learns whether a
  given sheet is connected. That leak requires already knowing the id, still
  grants no access, and is worth trading for a landlord being able to understand
  and fix their own error. Rejected: a vague "can't be connected" (unactionable),
  and naming the other account's email (exposes one tenant's identity to
  another).
- **Normalization lives in `packages/shared`**, next to the schema, so the web
  form and the API apply one rule rather than two that can drift.
- **The stored value is always a bare id.** Input accepts up to 500 characters
  so a full URL fits; what lands in the column is the extracted id.
- **Ownership verification is out of scope because it is not possible**, not
  because it was deprioritized. See Problem Frame.

---

## Requirements

- R1. A spreadsheet already connected to one account cannot be connected to
  another; the attempt is refused and nothing is saved.
- R2. The refusal tells the person the spreadsheet is already connected to
  another account, so they can choose a different one.
- R3. The guarantee holds at the database level, so two simultaneous saves
  cannot both succeed.
- R4. A landlord re-saving their own current spreadsheet succeeds — that is not
  a collision.
- R5. A pasted spreadsheet URL and the bare id it contains are treated as the
  same spreadsheet, both for storage and for collision detection.
- R6. Input that is not a plausible spreadsheet id or URL is rejected with a
  message saying so, rather than saved as a target that can never work.
- R7. Landlords who have not connected a sheet are unaffected — any number of
  accounts may have no target.
- R8. When an account is deleted, its spreadsheet becomes available again.
- R9. The Settings field communicates that a URL is acceptable.
- R10. The continuous sync job is unchanged; it needs no awareness of this.

---

## Key Flows

- F1. Connecting a fresh spreadsheet
  - **Trigger:** A landlord pastes a spreadsheet id or URL in Settings and saves.
  - **Steps:** The value is normalized to a bare id, validated, and stored;
    status refreshes as it does today.
  - **Covers:** R5, R6, R9.
- F2. Colliding with another account
  - **Trigger:** A landlord saves a spreadsheet another account already holds,
    in either id or URL form.
  - **Steps:** The write is refused; the message says the spreadsheet is already
    connected to another account; their existing target is untouched.
  - **Covers:** R1, R2, R5.
- F3. Re-saving an unchanged target
  - **Trigger:** A landlord saves the id they already have connected.
  - **Steps:** Succeeds normally.
  - **Covers:** R4.
- F4. Reclaiming after a deletion
  - **Trigger:** An account holding a spreadsheet is deleted; another landlord
    connects that spreadsheet.
  - **Steps:** Succeeds — the id is no longer claimed.
  - **Covers:** R8.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given account A has connected sheet S, when account B
  saves S, then the response is 409 `SHEET_ALREADY_CONNECTED` with the
  "already connected to another account" message, and B's stored target is
  unchanged.
- AE2. **Covers R5.** Given account A has connected bare id S, when account B
  saves `https://docs.google.com/spreadsheets/d/S/edit#gid=0`, then it is
  refused with the same 409.
- AE3. **Covers R5.** Given a save of a full spreadsheet URL that collides with
  nothing, when it succeeds, then the stored value is the bare id, not the URL.
- AE4. **Covers R4.** Given account A has connected sheet S, when A saves S
  again, then it succeeds.
- AE5. **Covers R6.** Given the input `my sheet`, when it is saved, then the
  response is 400 and nothing is stored.
- AE6. **Covers R7.** Given two accounts with no connected sheet, when both
  exist, then no constraint is violated.
- AE7. **Covers R3.** Given the migration has run, when the schema is inspected,
  then a unique index exists on `users(sheetSpreadsheetId)`.
- AE8. **Covers R8.** Given account A held sheet S and A is deleted, when
  account B saves S, then it succeeds.

---

## Scope Boundaries

Deferred or excluded:

- **Verifying that a landlord owns the spreadsheet they are connecting** — not
  possible with a shared service account (see Problem Frame). This is the reason
  the uniqueness constraint is load-bearing rather than a redundancy.
- **A transfer or force-claim flow** for moving a spreadsheet between accounts —
  no second landlord exists yet to need one; deleting the holding account
  already frees the id.
- **Changing the mirror away from clear-and-rewrite** — DEC-001 stands. This
  work removes the collision, not the overwrite semantics.
- **Detecting sheets already sharing data by other means** (e.g. two spreadsheets
  linked by `IMPORTRANGE`) — out of reach and out of scope.
- **Any change to the sync cron.**
- **Backfilling or re-normalizing existing stored values** — production holds one
  non-null target, already a bare id.

---

## Dependencies / Assumptions

- Google Drive file ids are `[A-Za-z0-9_-]` and comfortably longer than 20
  characters (44 in current practice). The accepted pattern is deliberately
  permissive on length so an older, shorter id is not rejected.
- Spreadsheet URLs contain the id in a `/spreadsheets/d/<id>` path segment. A
  Google URL of any other shape falls through to the bare-id rule and is
  rejected, which is correct — it is not a spreadsheet.
- Postgres unique indexes treat NULL as distinct, which is what makes R7 work
  without a partial index (verified behavior, not an assumption about Prisma).
- Production currently has one user with a non-null `sheetSpreadsheetId`, so the
  index builds instantly and needs no `CONCURRENTLY`. The migration runbook's
  pre-check is a duplicate scan; if it returns rows, the migration must not run
  until they are resolved by hand.
- `sheets.sync.test.ts` already assigns a unique target per landlord, and
  `invoices.export.test.ts` writes distinct values directly through Prisma, so
  neither is disturbed by the constraint. `settings.sheets.test.ts:73` saves
  `SHEET-ABC` *through the API* and will need a realistic id under R6 — the only
  existing test the format rule breaks (verified).
- The web Settings error path (`errOf(save.error)`) already renders server
  messages, so R2 needs no new frontend plumbing.

---

## Outstanding Questions

Deferred to planning:

- Whether the normalization helper lives inside
  `packages/shared/src/schemas/settings.ts` or in its own module beside it.
- Whether the P2002 translation belongs inline in `saveSheet` or in the central
  `errorHandler` keyed on the constraint name.

---

## Sources / Research

- `apps/api/src/settings/handlers.ts:140-147` — `saveSheet`, the unguarded write.
- `apps/api/prisma/schema.prisma:28` — `sheetSpreadsheetId String?`, unconstrained.
- `packages/shared/src/schemas/settings.ts:53-55` — `SaveSheetSchema`, currently
  any 1–200 character string.
- `apps/api/src/invoices/sheetSync.ts:74-111` — `mirrorUserSheet`, the
  clear-and-rewrite that turns a collision into data loss; and `:134-172`, the
  per-user error isolation that keeps it silent.
- `apps/web/src/pages/Settings.tsx:157-171` — the "Target spreadsheet ID" field
  and its existing error rendering.
- `docs/DECISIONS.md` DEC-001 (mirror overwrites the sheet), DEC-029
  (invite-gated signup, which makes this reachable).
