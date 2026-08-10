import { useTranslation } from 'react-i18next'
import { useInvoiceStats } from '@/hooks/useInvoiceStats'
import { STATUS_OPTIONS } from '@/lib/listParams'

// Small colored dot keys each chip to its status without full-intensity fills
// (the strip is a secondary summary, not the table's focal point).
const DOT: Record<string, string> = {
  PAID: 'bg-status-paid-foreground',
  REJECTED: 'bg-status-overdue-foreground',
  CANCELLED: 'bg-status-overdue-foreground',
  PENDING: 'bg-status-pending-foreground',
  APPROVED: 'bg-status-pending-foreground',
  SUBMITTED: 'bg-status-submitted-foreground',
}

type Props = {
  activeStatus: string
  onSelect: (status: string) => void
}

/**
 * Read-only all-time status totals that double as one-click status filters.
 * Secondary visual weight; the active chip is a toggle (re-click clears).
 */
export function StatusCounts({ activeStatus, onSelect }: Props) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useInvoiceStats()

  if (isError) return null

  if (isPending) {
    return (
      <div className="mb-4 flex flex-wrap gap-2" aria-busy="true">
        {STATUS_OPTIONS.map((s) => (
          <div key={s} className="h-7 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {t('statusCounts.total', { count: data.total })}
      </span>
      {STATUS_OPTIONS.map((s) => {
        const active = activeStatus === s
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            aria-label={`${t('statusCounts.filterBy', { status: t(`status.${s}`), count: data.counts[s] })}${active ? t('statusCounts.activeSuffix') : ''}`}
            onClick={() => onSelect(active ? '' : s)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              active
                ? 'border-primary bg-accent text-foreground ring-1 ring-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-accent/40'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${DOT[s]}`} aria-hidden />
            {t(`status.${s}`)}
            <span className="font-medium tabular-nums text-foreground">{data.counts[s]}</span>
          </button>
        )
      })}
    </div>
  )
}
