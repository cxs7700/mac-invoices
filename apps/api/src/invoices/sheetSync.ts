import type { PrismaClient } from '../../prisma/generated/client.ts'
import { applyColumnDropdowns, overwriteRows, resolveSheetTab } from '../integrations/sheets'
import {
  compareForExport,
  dropdownSpecs,
  EXPORT_HEADER,
  invoiceToRow,
  NON_EXPORTABLE_STATUSES,
} from './sheetRows'

// Continuous Google Sheets sync — the connected sheet is a FULL MIRROR of a
// landlord's exportable invoices (new + edits + deletes), refreshed by a
// CRON_SECRET-gated cron (see docs/specs/continuous-sheets-sync.md). It mirrors
// the vendor-digest flush: poll for change, act, then stamp a high-water
// mark, with per-user error isolation. Postgres stays the source of truth; the
// mirror overwrites whatever is in the sheet (DEC-001).

/**
 * The newest change time for a user: max of their newest `Invoice.updatedAt`
 * (covers create + ANY field edit, including fields that emit no InvoiceEvent),
 * their newest DELETED tombstone event (the only trace a hard-deleted invoice
 * leaves — the event has no FK to the invoice), and their newest
 * `Property.updatedAt` — the mirror also carries property data (the address
 * column + the Property dropdown's option list), so a property add/edit must
 * dirty the user. Property deletion leaves no timestamp trace, but deletion is
 * blocked while invoices reference the property, so a deleted address merely
 * lingers as a dropdown option until the next change (accepted). Null when the
 * user has no invoices, no delete events, and no properties.
 */
async function lastChangeAt(prisma: PrismaClient, userId: string): Promise<Date | null> {
  const [newestInvoice, newestDelete, newestProperty] = await Promise.all([
    prisma.invoice.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
    prisma.invoiceEvent.findFirst({
      where: { ownerUserId: userId, type: 'DELETED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.property.findFirst({
      where: { landlordId: userId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
  ])
  const times = [
    newestInvoice?.updatedAt,
    newestDelete?.createdAt,
    newestProperty?.updatedAt,
  ].filter((t): t is Date => t != null)
  if (times.length === 0) return null
  return new Date(Math.max(...times.map((t) => t.getTime())))
}

/**
 * Full-mirror one user's invoices into `spreadsheetId`: resolve the tab's grid
 * id, clear the tab, size the tab's Sheets Table to the rows about to land,
 * write the header + every exportable invoice row (ascending by invoice
 * number), re-apply the dropdown validation rules, then stamp
 * `User.sheetSyncedAt` and the mirrored invoices' `sheetsSyncedAt` to a
 * timestamp captured BEFORE the read.
 *
 * The gid lookup runs FIRST so a missing/renamed tab fails before the clear can
 * wipe data; validation runs LAST (after values) and a failure there also keeps
 * the user dirty. Order is overwrite-THEN-stamp: a death between the two leaves
 * the user "dirty" and the next run re-mirrors — a clear+rewrite (and a
 * validation re-apply) is idempotent, so a redundant pass is harmless
 * (at-least-once). Stamping to `flushStart` (not now) keeps the SyncBadge
 * honest: an invoice edited during the flush has `updatedAt > sheetsSyncedAt`
 * and shows "drifted" until the next pass. Returns the number of data rows
 * written. Throws a sanitized AppError on a Sheets failure.
 */
export async function mirrorUserSheet(
  prisma: PrismaClient,
  userId: string,
  spreadsheetId: string,
): Promise<number> {
  const flushStart = new Date()
  const tab = await resolveSheetTab(spreadsheetId)

  const [invoices, properties] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, status: { notIn: [...NON_EXPORTABLE_STATUSES] } },
      // The assigned property's address rides along as a column (empty when none).
      include: {
        property: { select: { address: true } },
        items: { orderBy: { sortOrder: 'asc' }, select: { description: true, sortOrder: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    }),
    // The Property dropdown's option list — rebuilt every pass so it tracks the table.
    prisma.property.findMany({ where: { landlordId: userId }, select: { address: true } }),
  ])

  // Ledger order: ascending invoice number (natural order), un-numbered rows last.
  invoices.sort(compareForExport)
  const dataRows = invoices.map(invoiceToRow)
  await overwriteRows(spreadsheetId, [EXPORT_HEADER, ...dataRows], tab)
  await applyColumnDropdowns(spreadsheetId, tab, dropdownSpecs(properties.map((p) => p.address)))

  await prisma.$transaction([
    // Guarded on the target we actually mirrored. A landlord can save a NEW
    // target (or disconnect) during this flush — that write nulls
    // `sheetSyncedAt` precisely so the next run re-mirrors, and an unguarded
    // stamp here would land afterwards and silently undo it, leaving the new
    // spreadsheet empty. `updateMany` with the target in its `where` makes the
    // stamp a no-op when the target changed under us.
    prisma.user.updateMany({
      where: { id: userId, sheetSpreadsheetId: spreadsheetId },
      data: { sheetSyncedAt: flushStart },
    }),
    prisma.invoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) }, userId },
      data: { sheetsSyncedAt: flushStart },
    }),
  ])

  return dataRows.length
}

export type SyncFlushSummary = { users: number; synced: number; skipped: number; failed: number }

/**
 * Minimal structural logger so callers can surface per-user sync failures
 * (e.g. Fastify's `request.log`) without this module depending on fastify.
 */
export type SyncFlushLogger = { warn: (obj: object, msg?: string) => void }

/**
 * Mirror every connected landlord whose data changed since their last sync.
 *
 * Candidates are users with a saved `sheetSpreadsheetId` ONLY. This was once the
 * distinguishing rule — the manual export fell back to a shared `GOOGLE_SHEET_ID`
 * env default while this job never did, because a clear+rewrite against one
 * shared sheet would let users clobber each other. That env default is now gone
 * everywhere (DEC-031 era cleanup); every path reads the per-user target and an
 * unconnected user is simply skipped. A user is also skipped when nothing changed
 * since `sheetSyncedAt` (saves Sheets quota). Each user is its own commit/error
 * boundary: one user's permission/429 failure is counted and never crashes the
 * job or blocks the others.
 */
export async function runSheetsSyncFlush(
  prisma: PrismaClient,
  log?: SyncFlushLogger,
): Promise<SyncFlushSummary> {
  const users = await prisma.user.findMany({
    where: { sheetSpreadsheetId: { not: null } },
    select: { id: true, sheetSpreadsheetId: true, sheetSyncedAt: true },
  })

  let synced = 0
  let skipped = 0
  let failed = 0
  for (const u of users) {
    try {
      const last = await lastChangeAt(prisma, u.id)
      const dirty = last !== null && (u.sheetSyncedAt === null || last > u.sheetSyncedAt)
      if (!dirty) {
        skipped++
        continue
      }
      // sheetSpreadsheetId is non-null by the query filter above.
      await mirrorUserSheet(prisma, u.id, u.sheetSpreadsheetId as string)
      synced++
    } catch (err) {
      failed++
      // Only the AppError code/message (already sanitized by the integration
      // layer) — never the raw error object, which could carry credentials.
      log?.warn(
        {
          userId: u.id,
          code: (err as { code?: string })?.code,
          message: err instanceof Error ? err.message : String(err),
        },
        'sheets sync failed for user',
      )
    }
  }
  return { users: users.length, synced, skipped, failed }
}
