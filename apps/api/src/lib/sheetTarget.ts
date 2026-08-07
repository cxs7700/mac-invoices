// Resolves a user's effective Google Sheets export target.
//
// `GOOGLE_SHEET_ID` is a single-tenant leftover from before signup existed —
// it points at the seeded landlord's spreadsheet. `mirrorUserSheet` is
// clear-and-rewrite, not append (see invoices/sheetSync.ts), so falling back
// to that env var for ANY user with no saved `sheetSpreadsheetId` would let a
// newly signed-up tenant's first Export wipe the incumbent landlord's sheet,
// and would leak that spreadsheet id back to them via Settings. The fallback
// stays, but ONLY for the seeded landlord (`LANDLORD_USER_ID`) — every other
// user with no connected sheet gets `null`, i.e. the same "not connected"
// behavior as before this feature existed.
export function resolveEffectiveSpreadsheetId(
  userId: string,
  savedSpreadsheetId: string | null,
): string | null {
  if (savedSpreadsheetId) return savedSpreadsheetId
  const landlordId = process.env.LANDLORD_USER_ID ?? 'landlord_seed_user'
  if (userId !== landlordId) return null
  return process.env.GOOGLE_SHEET_ID ?? null
}
