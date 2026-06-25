import { useTranslation } from 'react-i18next'
import { syncState, type SyncState } from '@/lib/format'

type Props = {
  sheetsSyncedAt: string | null | undefined
  updatedAt: string
}

const tone: Record<SyncState, string> = {
  'not-exported': 'bg-muted text-muted-foreground',
  exported: 'bg-status-paid text-status-paid-foreground',
  drifted: 'bg-status-overdue text-status-overdue-foreground',
}

/**
 * Per-invoice Google Sheets export state. "Drifted" means the invoice was edited
 * after its last export, so the sheet is stale (export is one-way, so this is an
 * advisory prompt to re-export — the app never re-pushes automatically).
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
