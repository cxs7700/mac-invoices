---
date: 2026-08-09
topic: sheets-disconnect
---

# Disconnect a Sheets Target — Requirements

## Summary

Let a landlord disconnect their Google spreadsheet, and make any target change
actually take effect. Two things: a `DELETE /api/settings/sheets` endpoint with
a Disconnect button behind it, and a fix for a pre-existing bug where switching
targets leaves the new spreadsheet permanently empty. Closes the follow-up
DEC-033(g) named as outstanding.

---

## Problem Frame

**There is no way to disconnect.** `SaveSheetSchema`
(`packages/shared/src/schemas/settings.ts:58-73`) rejects an empty value, and
the Settings Save button is disabled when the field is empty
(`apps/web/src/pages/Settings.tsx:255`). Once a spreadsheet id is saved it can
only be replaced, never cleared. DEC-033(g) recorded this as an accepted gap
with "delete the account or fix the row by hand" as the only remedy — a drastic
answer to an ordinary mistake like pasting the wrong sheet.

It also interacts with the uniqueness constraint added in DEC-033. Because
`users.sheetSpreadsheetId` is now UNIQUE, a landlord holding the wrong id
denies it to everyone else, and has no way to give it back. Disconnecting
releases it.

**Separately, changing the target does not trigger a sync.**
`runSheetsSyncFlush` (`apps/api/src/invoices/sheetSync.ts:146-153`) decides a
landlord is dirty by comparing their newest invoice/property change against
`User.sheetSyncedAt`. Changing `sheetSpreadsheetId` touches neither side of that
comparison. So a landlord who switches from sheet A to sheet B, and has not
edited an invoice since their last sync, is judged clean — and **sheet B is
never populated**. It stays empty until something unrelated marks them dirty or
they press "Sync now" manually.

This is a pre-existing bug on the switch-target path, not one introduced by the
uniqueness work. It is in scope here because disconnect-then-reconnect walks
directly into it, and because an empty spreadsheet is indistinguishable, to the
landlord, from the integration being broken.

---

## Key Decisions

- **Disconnecting is its own verb: `DELETE /api/settings/sheets`.** Rejected:
  making `PATCH` accept `null` or `""`. This follows from the UI being an
  explicit button rather than an empty save — if no save payload ever needs to
  mean "clear", then `SaveSheetSchema` keeps rejecting empty, and accidental
  disconnection becomes *structurally impossible* rather than merely unlikely.
  There is no way to spell it in a save request.
- **An explicit Disconnect button, not "empty the field and Save".** Rejected:
  enabling Save on an empty field, which makes disconnecting indistinguishable
  from a slip of select-all-delete. Also rejected: supporting both, which keeps
  the accidental-clear risk while adding a second path to test and document.
- **Any successful save or disconnect resets `sheetSyncedAt` to null,
  unconditionally.** Rejected: resetting only when the id actually changed,
  which needs a read-then-write — and if two saves interleave, the loser skips
  the reset and the bug returns. Unconditional needs no read and has no race.
  Its cost is that pressing Save twice on one id causes a redundant mirror,
  which is acceptable: the mirror is idempotent (DEC-001), and "make this sheet
  current" is a fair reading of what pressing Save means.
- **The response shape is the same status body `PATCH` returns**, so the client
  refreshes through one path.
- **No confirmation dialog.** The action is explicitly named and reversible by
  re-saving.
- **No rate limiting**, consistent with the rest of the settings routes; the
  gap DEC-033(g) records on that point is unchanged and still open.
- **Squatting is not solved, only softened.** A landlord who grabbed the wrong
  sheet can now release it; a hostile holder still will not press the button.
  The remaining remedy for that case is unchanged.

---

## Requirements

- R1. A landlord with a connected spreadsheet can disconnect it, leaving no
  target.
- R2. Disconnecting is a deliberate action, distinct from editing the target —
  no ordinary edit-and-save sequence can clear a connection.
- R3. After disconnecting, the connection status reports no target.
- R4. A disconnected spreadsheet id becomes available for another account to
  connect.
- R5. Disconnecting when already disconnected succeeds and changes nothing.
- R6. Disconnecting requires authentication and affects only the caller's own
  target.
- R7. After a target is saved, the next sync run treats the landlord as needing
  a full mirror, so the newly connected spreadsheet is populated without
  waiting for an unrelated change.
- R8. After a disconnect, the same holds for whatever is connected next.
- R9. The disconnect control appears only when a spreadsheet is connected.
- R10. Export and connection-test continue to report a clear "no sheet
  connected" error when there is no target.
- R11. The continuous sync job continues to skip landlords with no target.

---

## Key Flows

- F1. Disconnecting
  - **Trigger:** A landlord with a connected sheet opens Settings and chooses
    Disconnect.
  - **Steps:** The target is cleared; status shows no connection; the input
    empties; the id is free for anyone else.
  - **Covers:** R1, R3, R4, R9.
- F2. Correcting a mistake
  - **Trigger:** A landlord connected the wrong spreadsheet.
  - **Steps:** They disconnect, then save the right id; the next sync run
    mirrors their invoices into it without further action.
  - **Covers:** R1, R7, R8.
- F3. Switching spreadsheets
  - **Trigger:** A landlord saves a different id over an existing one.
  - **Steps:** The new sheet is populated by the next sync run even though no
    invoice changed.
  - **Covers:** R7.
- F4. Working with no sheet
  - **Trigger:** A disconnected landlord uses the app.
  - **Steps:** Export and test report "no sheet connected"; the sync job passes
    them over; nothing errors.
  - **Covers:** R10, R11.

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given a landlord with spreadsheet S connected, when
  they disconnect, then the response reports no target and the stored value is
  cleared.
- AE2. **Covers R4.** Given account A disconnects spreadsheet S, when account B
  saves S, then it succeeds.
- AE3. **Covers R5.** Given a landlord with no target, when they disconnect,
  then it succeeds and the target remains empty.
- AE4. **Covers R6.** Given no session, when a disconnect is attempted, then it
  is rejected as unauthenticated and nothing changes.
- AE5. **Covers R7.** Given a landlord whose last sync is recorded, when they
  save a target, then their sync high-water mark is cleared so the next run
  mirrors in full.
- AE6. **Covers R8.** Given the same landlord, when they disconnect, then the
  high-water mark is cleared likewise.
- AE7. **Covers R2.** Given the Settings form, when the target field is emptied
  and saved, then the connection is not cleared — the save is refused as
  before.
- AE8. **Covers R9.** Given a landlord with no connected sheet, when Settings
  loads, then no disconnect control is offered.
- AE9. **Covers R10.** Given a disconnected landlord, when they export or test
  the connection, then each reports that no sheet is connected.

---

## Scope Boundaries

Deferred or excluded:

- **Rate limiting `PATCH`/`DELETE /api/settings/sheets`** — the gap recorded in
  DEC-033(g) stands, unchanged by this work.
- **A real answer to squatting** — releasing a sheet requires the holder's
  cooperation. An administrative override or ownership-transfer flow remains
  out of scope, as in DEC-033.
- **A confirmation dialog** on disconnect.
- **Resetting the per-invoice `sheetsSyncedAt` stamps** on a target change.
  They drive the SyncBadge only, and the full mirror that follows re-stamps
  them; between the change and the next flush a badge may briefly overstate how
  current the new sheet is (accepted).
- **Changing the mirror away from clear-and-rewrite** — DEC-001 stands.
- **Any change to the export, connection-test, or cron paths** — all three
  already handle a null target correctly (verified).

---

## Dependencies / Assumptions

- `exportInvoices` (`apps/api/src/invoices/handlers.ts:445-451`) already throws
  `SHEET_NOT_CONNECTED` / 400 when the target is null, and `testSheet`
  (`apps/api/src/settings/handlers.ts:187-193`) already throws "No target
  spreadsheet set" — so R10 needs no new code, only coverage (verified).
- `runSheetsSyncFlush` already filters candidates to
  `sheetSpreadsheetId: { not: null }` (`sheetSync.ts:138-141`), so R11 holds
  without change (verified).
- Nulling `User.sheetSyncedAt` is sufficient to force a full mirror: `dirty`
  is true whenever `sheetSyncedAt` is null and the landlord has any invoice,
  delete event, or property (`sheetSync.ts:149`). A landlord with no data at
  all stays clean, which is correct — there is nothing to mirror.
- Clearing `sheetSpreadsheetId` releases the value under the unique index added
  in DEC-033, because Postgres treats NULLs as distinct.
- The Settings UI already resets its local input state after a successful save;
  disconnect follows the same pattern.

---

## Outstanding Questions

Deferred to planning:

- Whether the disconnect handler shares a helper with `saveSheet` for the
  status response, or simply calls `getSheets` as `saveSheet` does.
- Whether the web layer gets a dedicated `useDisconnectSheet` mutation or
  extends the existing `useSaveSheet` hook.

---

## Sources / Research

- `packages/shared/src/schemas/settings.ts:58-73` — `SaveSheetSchema`, which
  rejects empty input and therefore cannot express a disconnect.
- `apps/api/src/settings/handlers.ts:150-184` — `saveSheet`, where the
  `sheetSyncedAt` reset belongs, and `testSheet`.
- `apps/api/src/invoices/sheetSync.ts:30-55` and `:146-153` — `lastChangeAt`
  and the dirty check that a target change does not affect: the stale-sync bug.
- `apps/api/src/invoices/handlers.ts:436-455` — `exportInvoices` and its
  existing null-target error.
- `apps/web/src/pages/Settings.tsx:176-265` — the Sheets section, its local
  input state, and the Save button's disabled-on-empty rule.
- `docs/DECISIONS.md` DEC-033(g) — the follow-up this closes; DEC-001 — the
  clear-and-rewrite mirror that makes a redundant pass harmless.
