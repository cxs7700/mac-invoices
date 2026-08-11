import { useTranslation } from 'react-i18next'
import { syncState, type SyncState } from '@/lib/format'

type Props = {
  sheetsSyncedAt: string | null | undefined
  updatedAt: string
}

const tone: Record<SyncState, string> = {
  'not-exported': 'bg-status-overdue text-status-overdue-foreground',
  exported: 'bg-status-paid text-status-paid-foreground',
  drifted: 'bg-status-overdue text-status-overdue-foreground',
}

/**
 * Per-invoice Google Sheets sync state, shown as a plain Yes/No: is the sheet
 * currently accurate for this invoice? "Drifted" (edited after its last sync,
 * so the sheet row is momentarily stale) reads "No" alongside never-exported —
 * the two stay distinct states only for the hover hint. Continuous sync
 * re-mirrors a drifted invoice on the next cron pass (~15 min), or immediately
 * via "Sync now".
 */
export function SyncBadge({ sheetsSyncedAt, updatedAt }: Props) {
  const { t } = useTranslation()
  const state = syncState(sheetsSyncedAt, updatedAt)
  const label = t(`sync.label.${state}`)
  return (
    <span
      role="status"
      aria-label={t('sync.aria', { label })}
      title={t(`sync.hint.${state}`)}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[state]}`}
    >
      {label}
    </span>
  )
}
