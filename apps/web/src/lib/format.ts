import { localeTag } from './i18n'

// Invoice status / sync labels now live in the i18n catalogs (status.* / sync.*)
// and render via t() in StatusBadge / SyncBadge — no hardcoded label maps here.

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

export type SyncState = 'not-exported' | 'exported' | 'drifted'

/**
 * Per-invoice Sheets export state: not yet exported, exported, or drifted
 * (edited after the last export, so the sheet is now stale). Read-only — the app
 * never re-pushes (export is one-way); "drifted" prompts a manual re-export.
 *
 * The comparison is exact — no tolerance window. It once needed one, because the
 * mirror's `sheetsSyncedAt` stamp went through Prisma and so bumped `updatedAt`
 * with it, leaving every freshly-exported row looking edited-after-export by the
 * duration of the whole pass; the stamp is now a raw UPDATE that leaves
 * `updatedAt` alone (see `mirrorUserSheet`). A tolerance here would only hide a
 * genuine edit made moments after an export.
 *
 * `sheetsSyncedAt` is stamped to the instant the pass STARTED, so an invoice
 * edited mid-pass reads drifted until the next one — which is correct: the sheet
 * was written from the pre-edit read.
 */
export function syncState(sheetsSyncedAt: string | null | undefined, updatedAt: string): SyncState {
  if (!sheetsSyncedAt) return 'not-exported'
  return new Date(updatedAt).getTime() > new Date(sheetsSyncedAt).getTime()
    ? 'drifted'
    : 'exported'
}
