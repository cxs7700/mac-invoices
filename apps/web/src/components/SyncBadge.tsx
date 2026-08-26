import { useTranslation } from 'react-i18next'
import { syncState, type SyncState } from '@/lib/format'

type Props = {
  sheetsSyncedAt: string | null | undefined
  updatedAt: string
  /**
   * Spell the state out ("Not exported") instead of the terse "No".
   *
   * The invoice table has a "Sheet" column header to give "No" its meaning, and
   * a whole column of long labels would crowd it. A single invoice's header has
   * no such column heading, so the bare "No" there reads as an answer to a
   * question nobody asked.
   */
  long?: boolean
}

const tone: Record<SyncState, string> = {
  'not-exported': 'bg-status-overdue text-status-overdue-foreground',
  exported: 'bg-status-paid text-status-paid-foreground',
  drifted: 'bg-status-overdue text-status-overdue-foreground',
}

/**
 * Per-invoice Google Sheets sync state. By default a plain Yes/No answering "is
 * the sheet currently accurate for this invoice?", which is what the table's
 * "Sheet" column wants; `long` spells the state out for the single-invoice
 * header, where there is no column heading to supply the question.
 *
 * "Drifted" (edited after its last sync, so the sheet row is momentarily stale)
 * collapses into "No" alongside never-exported in the short form — there the
 * two are distinguished only by the hover hint. The long form keeps them
 * apart. Continuous sync re-mirrors a drifted invoice on the next cron pass
 * (~15 min), or immediately via "Sync now".
 */
export function SyncBadge({ sheetsSyncedAt, updatedAt, long }: Props) {
  const { t } = useTranslation()
  const state = syncState(sheetsSyncedAt, updatedAt)
  const label = t(`sync.${long ? 'labelLong' : 'label'}.${state}`)
  const badge = (
    <span
      role="status"
      // The aria label always spells the state out, so a screen reader never
      // hears a bare "No" regardless of which visual form is rendered.
      aria-label={t('sync.aria', { label: t(`sync.labelLong.${state}`) })}
      title={t(`sync.hint.${state}`)}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[state]}`}
    >
      {label}
    </span>
  )
  // "Drifted" is the one state whose name doesn't explain itself, and the
  // title-attribute hint is unreachable on touch devices — so the long form
  // spells it out next to the badge.
  if (long && state === 'drifted') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {badge}
        <span className="text-xs text-muted-foreground">{t('sync.hint.drifted')}</span>
      </span>
    )
  }
  return badge
}
