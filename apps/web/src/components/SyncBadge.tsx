import { syncState, SYNC_LABEL, type SyncState } from '@/lib/format'

type Props = {
  sheetsSyncedAt: string | null | undefined
  updatedAt: string
}

const tone: Record<SyncState, string> = {
  'not-exported': 'bg-muted text-muted-foreground',
  exported: 'bg-status-paid text-status-paid-foreground',
  drifted: 'bg-status-overdue text-status-overdue-foreground',
}

const hint: Record<SyncState, string> = {
  'not-exported': 'Not yet exported to the Google Sheet',
  exported: 'Synced to the Google Sheet',
  drifted: 'Edited after the last export — re-export to refresh the sheet',
}

/**
 * Per-invoice Google Sheets export state. "Drifted" means the invoice was edited
 * after its last export, so the sheet is stale (export is one-way, so this is an
 * advisory prompt to re-export — the app never re-pushes automatically).
 */
export function SyncBadge({ sheetsSyncedAt, updatedAt }: Props) {
  const state = syncState(sheetsSyncedAt, updatedAt)
  const label = SYNC_LABEL[state]
  return (
    <span
      role="status"
      aria-label={`Sheets export: ${label}`}
      title={hint[state]}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[state]}`}
    >
      {label}
    </span>
  )
}
