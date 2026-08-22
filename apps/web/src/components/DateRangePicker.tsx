import { useTranslation } from 'react-i18next'
import { DATE_RANGE_PRESETS, CUSTOM_RANGE, type DateRangePreset } from '@/lib/listParams'

const field =
  'rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const RANGE_LABEL_KEYS: Record<DateRangePreset, string> = {
  '1w': 'filterBar.range1w',
  '1m': 'filterBar.range1m',
  '3m': 'filterBar.range3m',
  '6m': 'filterBar.range6m',
  ytd: 'filterBar.rangeYtd',
  '1y': 'filterBar.range1y',
}

const RANGE_CHOICES: readonly (DateRangePreset | typeof CUSTOM_RANGE)[] = [
  ...DATE_RANGE_PRESETS,
  CUSTOM_RANGE,
]

export type DateRangeValue = { range: string; from: string; to: string }

/**
 * The lookback control: preset buttons (1W…1Y) plus a custom from/to escape
 * hatch. Shared by the invoice list's FilterBar and the dashboard so one
 * lookback means the same window in both places. `range: ''` is no date filter
 * (all time) — clicking the active choice again clears back to it.
 */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue
  onChange: (patch: Partial<DateRangeValue>) => void
}) {
  const { t } = useTranslation()

  // Leaving the custom range drops its dates, so a stale window can't survive
  // invisibly behind a preset (or behind no date filter at all).
  const selectRange = (range: string) =>
    onChange(range === CUSTOM_RANGE ? { range } : { range, from: '', to: '' })

  const dateError = value.range === CUSTOM_RANGE && value.from && value.to && value.from > value.to

  return (
    <>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.dateRange')}
        <div role="group" aria-label={t('filterBar.filterByDateRange')} className="flex gap-1">
          {RANGE_CHOICES.map((r) => {
            const active = value.range === r
            const label = r === CUSTOM_RANGE ? t('filterBar.rangeCustom') : t(RANGE_LABEL_KEYS[r])
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                // A second click on the active choice clears the date filter.
                onClick={() => selectRange(active ? '' : r)}
                className={`rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card text-foreground'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {value.range === CUSTOM_RANGE && (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filterBar.fromDate')}
            <input
              type="date"
              aria-label={t('filterBar.fromDate')}
              className={field}
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ from: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filterBar.toDate')}
            <input
              type="date"
              aria-label={t('filterBar.toDate')}
              className={field}
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ to: e.target.value })}
            />
          </label>
        </>
      )}

      {dateError && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {t('filterBar.dateRangeError')}
        </p>
      )}
    </>
  )
}
