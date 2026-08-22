import { useTranslation } from 'react-i18next'
import { localeTag } from '@/lib/i18n'
import { formatMoney } from '@/lib/format'

export type MonthPoint = { month: string; count: number; amount: string }

/** `2026-02` → a localized short month label ("Feb", and the year when it turns). */
function monthLabel(month: string, showYear: boolean): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString(localeTag(), {
    month: 'short',
    ...(showYear ? { year: '2-digit' } : {}),
    timeZone: 'UTC',
  })
}

/**
 * Monthly spend as vertical bars — one series, so it wears the primary hue with
 * no legend (the card title names it). Laid out with flex rather than a fixed
 * viewBox so it stays readable at any width without measuring the DOM, and the
 * month labels thin out (every 2nd/3rd) once the buckets outnumber the space.
 * Each column carries its own hover tooltip and a screen-reader sentence.
 */
export function SpendTrendChart({ points }: { points: MonthPoint[] }) {
  const { t } = useTranslation()

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('spendBars.empty')}</p>
  }

  const values = points.map((p) => parseFloat(p.amount))
  const max = Math.max(1, ...values)
  // Label every bucket while they fit; past that, every 2nd or 3rd.
  const labelEvery = points.length <= 8 ? 1 : points.length <= 16 ? 2 : 3
  // Only the labels that actually render carry a year, and only where it changes
  // — comparing against the previous LABELED bucket, so a year turnover that
  // lands on a skipped one is still announced.
  const labels = points.map((p, i) => {
    if (i % labelEvery !== 0) return ''
    const prev = points[i - labelEvery]
    return monthLabel(p.month, !prev || prev.month.slice(0, 4) !== p.month.slice(0, 4))
  })

  return (
    <div>
      <div className="mb-1 text-xs tabular-nums text-muted-foreground">{formatMoney(max)}</div>
      <ul className="flex h-40 items-end gap-0.5 border-b border-border">
        {points.map((p) => {
          const value = parseFloat(p.amount)
          // A zero month stays flat (a visible gap); anything above it keeps a
          // 3% floor so a small month is still a mark rather than a hairline.
          const pct = value === 0 ? 0 : Math.max(3, (value / max) * 100)
          return (
            <li
              key={p.month}
              className="group flex h-full flex-1 items-end"
              title={`${monthLabel(p.month, true)} · ${formatMoney(p.amount)} · ${p.count}`}
            >
              <div
                className="w-full rounded-t bg-primary transition-opacity group-hover:opacity-70"
                style={{ height: `${pct}%` }}
              >
                <span className="sr-only">
                  {monthLabel(p.month, true)}: {formatMoney(p.amount)}, {p.count}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <ul className="flex gap-0.5" aria-hidden="true">
        {points.map((p, i) => (
          <li
            key={p.month}
            className="flex-1 overflow-hidden pt-1 text-center text-[10px] leading-tight text-muted-foreground"
          >
            {labels[i]}
          </li>
        ))}
      </ul>
    </div>
  )
}
