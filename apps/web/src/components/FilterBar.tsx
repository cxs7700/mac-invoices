import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { propertyLabel, type InvoiceSortField } from '@mac-invoices/shared'
import {
  STATUS_OPTIONS,
  SORT_OPTIONS,
  DATE_RANGE_PRESETS,
  CUSTOM_RANGE,
  hasActiveFilters,
  type ListFilters,
  type DateRangePreset,
} from '@/lib/listParams'
import { useProperties } from '@/hooks/useProperties'

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

const SORT_LABEL_KEYS: Record<InvoiceSortField, string> = {
  invoiceNumber: 'filterBar.sortNumber',
  invoiceDate: 'filterBar.sortDate',
  amount: 'filterBar.sortAmount',
  status: 'filterBar.sortStatus',
}

type Props = {
  filters: ListFilters
  onChange: (patch: Partial<ListFilters>) => void
  onClear: () => void
}

/**
 * Status / date-range / vendor / sort controls for the invoice list. Filter
 * changes flow up via onChange (the parent owns URL state); the vendor input is
 * debounced so typing doesn't issue a request per keystroke.
 */
export function FilterBar({ filters, onChange, onClear }: Props) {
  const { t } = useTranslation()
  const { data: propData } = useProperties()
  const properties = propData?.data ?? []
  // Local mirrors of the free-text inputs so we can debounce before lifting up.
  const [vendor, setVendor] = useState(filters.vendor)
  const [search, setSearch] = useState(filters.search)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Whenever ANY committed filter changes (clear-all, status/sort/page, or a
  // committed vendor/search), resync the inputs to the URL value and cancel a
  // pending debounce — otherwise an uncommitted keystroke could resurrect a
  // just-cleared value. Keyed on the full signature, adjusting state in render.
  const sig = `${filters.status}|${filters.range}|${filters.from}|${filters.to}|${filters.vendor}|${filters.search}|${filters.propertyId}|${filters.sort}|${filters.order}|${filters.page}`
  const [syncedSig, setSyncedSig] = useState(sig)
  if (sig !== syncedSig) {
    setSyncedSig(sig)
    setVendor(filters.vendor)
    setSearch(filters.search)
  }

  // Cancel pending debounces whenever the committed filters change (cleanup runs
  // on each sig change and on unmount) — so an uncommitted keystroke can't
  // resurrect a just-cleared value.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(searchTimer.current)
    },
    [sig],
  )

  const handleVendor = (value: string) => {
    setVendor(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange({ vendor: value }), 300)
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => onChange({ search: value }), 300)
  }

  // Leaving the custom range drops its dates, so a stale window can't survive
  // invisibly behind a preset (or behind no date filter at all).
  const selectRange = (range: string) =>
    onChange(range === CUSTOM_RANGE ? { range } : { range, from: '', to: '' })

  const dateError =
    filters.range === CUSTOM_RANGE && filters.from && filters.to && filters.from > filters.to

  return (
    <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.search')}
        <input
          type="search"
          aria-label={t('filterBar.searchByDescription')}
          placeholder={t('filterBar.searchDescriptionPlaceholder')}
          className={field}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.status')}
        <select
          aria-label={t('filterBar.filterByStatus')}
          className={field}
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value })}
        >
          <option value="">{t('filterBar.allStatuses')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.property')}
        <select
          aria-label={t('filterBar.filterByProperty')}
          className={field}
          value={filters.propertyId}
          onChange={(e) => onChange({ propertyId: e.target.value })}
        >
          <option value="">{t('filterBar.allProperties')}</option>
          <option value="none">{t('filterBar.unassigned')}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.dateRange')}
        <div role="group" aria-label={t('filterBar.filterByDateRange')} className="flex gap-1">
          {RANGE_CHOICES.map((r) => {
            const active = filters.range === r
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

      {filters.range === CUSTOM_RANGE && (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filterBar.fromDate')}
            <input
              type="date"
              aria-label={t('filterBar.fromDate')}
              className={field}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => onChange({ from: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('filterBar.toDate')}
            <input
              type="date"
              aria-label={t('filterBar.toDate')}
              className={field}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => onChange({ to: e.target.value })}
            />
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.vendor')}
        <input
          type="text"
          aria-label={t('filterBar.filterByVendor')}
          placeholder={t('filterBar.searchVendorPlaceholder')}
          className={field}
          value={vendor}
          onChange={(e) => handleVendor(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('filterBar.sortBy')}
        <select
          aria-label={t('filterBar.sortBy')}
          className={field}
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(SORT_LABEL_KEYS[s])}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        aria-label={
          filters.order === 'asc' ? t('filterBar.sortAscending') : t('filterBar.sortDescending')
        }
        title={filters.order === 'asc' ? t('filterBar.ascending') : t('filterBar.descending')}
        className={`${field} md:self-end`}
        onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
      >
        {filters.order === 'asc' ? t('filterBar.ascShort') : t('filterBar.descShort')}
      </button>

      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-primary md:self-end md:pb-2"
        >
          {t('filterBar.clearFilters')}
        </button>
      )}

      {dateError && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {t('filterBar.dateRangeError')}
        </p>
      )}
    </div>
  )
}
