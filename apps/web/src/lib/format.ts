import { localeTag } from './i18n'

/** Display labels for invoice statuses — the single source for status text. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  SUBMITTED: 'Submitted',
}

/** Format an invoice amount (a string from the API, per CONV-013) for display.
 * Currency stays USD; only the grouping/format localizes by the active locale. */
export function formatMoney(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(localeTag(), { style: 'currency', currency: 'USD' }).format(n)
}

/** Format a date (ISO string or Date), localized by the active locale (UTC, date-only stable). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(localeTag(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
}

/** Whether an invoice should display as overdue (unpaid + due date past). */
export function isOverdue(status: string, dueDate: string | Date | null | undefined): boolean {
  if (status !== 'PENDING' && status !== 'APPROVED') return false
  if (dueDate == null) return false
  return new Date(dueDate).getTime() < Date.now()
}

export type SyncState = 'not-exported' | 'exported' | 'drifted'

export const SYNC_LABEL: Record<SyncState, string> = {
  'not-exported': 'Not exported',
  exported: 'Exported',
  drifted: 'Drifted',
}

// The Sheets export stamp also bumps the row's updatedAt (~the same instant), so
// only treat an invoice as "drifted" once it was edited more than this long
// after its last export — otherwise freshly-exported rows would flicker drifted.
const DRIFT_TOLERANCE_MS = 2000

/**
 * Per-invoice Sheets export state: not yet exported, exported, or drifted
 * (edited after the last export, so the sheet is now stale). Read-only — the app
 * never re-pushes (export is one-way); "drifted" prompts a manual re-export.
 */
export function syncState(
  sheetsSyncedAt: string | null | undefined,
  updatedAt: string,
): SyncState {
  if (!sheetsSyncedAt) return 'not-exported'
  const drift = new Date(updatedAt).getTime() - new Date(sheetsSyncedAt).getTime()
  return drift > DRIFT_TOLERANCE_MS ? 'drifted' : 'exported'
}
