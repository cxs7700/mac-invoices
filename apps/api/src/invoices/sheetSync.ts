import type { PrismaClient } from '../../prisma/generated/client.ts'
import { applyColumnDropdowns, overwriteRows, resolveSheetTabId } from '../integrations/sheets'
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
// the contractor-digest flush: poll for change, act, then stamp a high-water
// mark, with per-user error isolation. Postgres stays the source of truth; the
// mirror overwrites whatever is in the sheet (DEC-001).

/**
 * The newest change time for a user: max of their newest `Invoice.updatedAt`
 * (covers create + ANY field edit, including fields that emit no InvoiceEvent)
 * and their newest DELETED tombstone event (the only trace a hard-deleted
 * invoice leaves — the event has no FK to the invoice). Null when the user has
 * never had an invoice and never deleted one.
 */
async function lastChangeAt(prisma: PrismaClient, userId: string): Promise<Date | null> {
  const [newestInvoice, newestDelete] = await Promise.all([
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
  ])
  const times = [newestInvoice?.updatedAt, newestDelete?.createdAt].filter(
    (t): t is Date => t != null,
  )
  if (times.length === 0) return null
  return new Date(Math.max(...times.map((t) => t.getTime())))
}

/**
 * Full-mirror one user's invoices into `spreadsheetId`: resolve the tab's grid
 * id, clear the tab, write the header + every exportable invoice row (ascending
 * by invoice number), re-apply the dropdown validation rules, then stamp
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
  const sheetId = await resolveSheetTabId(spreadsheetId)

  const [invoices, properties] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, status: { notIn: [...NON_EXPORTABLE_STATUSES] } },
      // The assigned property's address rides along as a column (empty when none).
      include: { property: { select: { address: true } } },
      orderBy: { invoiceDate: 'asc' },
    }),
    // The Property dropdown's option list — rebuilt every pass so it tracks the table.
    prisma.property.findMany({ where: { landlordId: userId }, select: { address: true } }),
  ])

  // Ledger order: ascending invoice number (natural order), un-numbered rows last.
  invoices.sort(compareForExport)
  const dataRows = invoices.map(invoiceToRow)
  await overwriteRows(spreadsheetId, [EXPORT_HEADER, ...dataRows])
  await applyColumnDropdowns(
    spreadsheetId,
    sheetId,
    dropdownSpecs(properties.map((p) => p.address)),
  )

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { sheetSyncedAt: flushStart } }),
    prisma.invoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) }, userId },
      data: { sheetsSyncedAt: flushStart },
    }),
  ])

  return dataRows.length
}

export type SyncFlushSummary = { users: number; synced: number; skipped: number; failed: number }

/**
 * Mirror every connected landlord whose data changed since their last sync.
 *
 * Candidates are users with a saved `sheetSpreadsheetId` ONLY — continuous sync
 * never uses the shared `GOOGLE_SHEET_ID` env default, because a per-user
 * clear+rewrite against one shared sheet would let users clobber each other. A
 * user is skipped when nothing changed since `sheetSyncedAt` (saves Sheets
 * quota). Each user is its own commit/error boundary: one user's permission/429
 * failure is counted and never crashes the job or blocks the others.
 */
export async function runSheetsSyncFlush(prisma: PrismaClient): Promise<SyncFlushSummary> {
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
    } catch {
      failed++
    }
  }
  return { users: users.length, synced, skipped, failed }
}
