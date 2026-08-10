import { useTranslation } from 'react-i18next'
import { statusTone, type StatusTone } from '@mac-invoices/shared'
import { useInvoiceStats } from '@/hooks/useInvoiceStats'
import { STATUS_OPTIONS } from '@/lib/listParams'

// Small colored dot keys each chip to its status without full-intensity fills
// (the strip is a secondary summary, not the table's focal point). Colours come
// from the shared status→tone mapping, so a status reads the same here as it
// does on the PDF; previously REJECTED/CANCELLED and PENDING/APPROVED shared a
// dot apiece and were indistinguishable.
const DOT: Record<StatusTone, string> = {
  amber: 'bg-tone-amber-foreground',
  blue: 'bg-tone-blue-foreground',
  violet: 'bg-tone-violet-foreground',
  green: 'bg-tone-green-foreground',
  red: 'bg-tone-red-foreground',
  slate: 'bg-tone-slate-foreground',
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
            <span
              className={`inline-block h-2 w-2 rounded-full ${DOT[statusTone(s)]}`}
              aria-hidden
            />
            {t(`status.${s}`)}
            <span className="font-medium tabular-nums text-foreground">{data.counts[s]}</span>
          </button>
        )
      })}
    </div>
  )
}
