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
