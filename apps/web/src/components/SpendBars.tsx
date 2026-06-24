import { formatMoney } from '@/lib/format'

export type SpendBarRow = { key: string; label: string; amount: string; count: number }

/**
 * Dependency-free horizontal bars for a small spend breakdown — bars are scaled
 * to the largest row. Each row shows the amount and invoice count.
 */
export function SpendBars({ rows }: { rows: SpendBarRow[] }) {
  const values = rows.map((r) => parseFloat(r.amount))
  const max = Math.max(1, ...values)

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const value = parseFloat(r.amount)
        const pct = Math.max(2, Math.round((value / max) * 100))
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-foreground">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatMoney(r.amount)} <span className="text-xs">· {r.count}</span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} aria-hidden />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
