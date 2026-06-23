import { useEffect, useRef, useState } from 'react'
import type { InvoiceSortField } from '@mac-invoices/shared'
import {
  STATUS_OPTIONS,
  SORT_OPTIONS,
  hasActiveFilters,
  type ListFilters,
} from '@/lib/listParams'

const field =
  'rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const SORT_LABELS: Record<InvoiceSortField, string> = {
  invoiceDate: 'Date',
  amount: 'Amount',
  dueDate: 'Due date',
  status: 'Status',
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
  // Local mirrors of the free-text inputs so we can debounce before lifting up.
  const [vendor, setVendor] = useState(filters.vendor)
  const [search, setSearch] = useState(filters.search)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Whenever ANY committed filter changes (clear-all, status/sort/page, or a
  // committed vendor/search), resync the inputs to the URL value and cancel a
  // pending debounce — otherwise an uncommitted keystroke could resurrect a
  // just-cleared value. Keyed on the full signature, adjusting state in render.
  const sig = `${filters.status}|${filters.from}|${filters.to}|${filters.vendor}|${filters.search}|${filters.sort}|${filters.order}|${filters.page}`
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

  const dateError = filters.from && filters.to && filters.from > filters.to

  return (
    <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Search
        <input
          type="search"
          aria-label="Search by description"
          placeholder="Search description…"
          className={field}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Status
        <select
          aria-label="Filter by status"
          className={field}
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        From date
        <input
          type="date"
          aria-label="From date"
          className={field}
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        To date
        <input
          type="date"
          aria-label="To date"
          className={field}
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Vendor
        <input
          type="text"
          aria-label="Filter by vendor"
          placeholder="Search vendor…"
          className={field}
          value={vendor}
          onChange={(e) => handleVendor(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Sort by
        <select
          aria-label="Sort by"
          className={field}
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        aria-label={filters.order === 'asc' ? 'Sort ascending' : 'Sort descending'}
        title={filters.order === 'asc' ? 'Ascending' : 'Descending'}
        className={`${field} md:self-stretch`}
        onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
      >
        {filters.order === 'asc' ? '↑ Asc' : '↓ Desc'}
      </button>

      {hasActiveFilters(filters) && (
        <button type="button" onClick={onClear} className="text-sm text-primary md:self-end md:pb-2">
          Clear filters
        </button>
      )}

      {dateError && (
        <p role="alert" className="basis-full text-sm text-destructive">
          Start date must be on or before the end date.
        </p>
      )}
    </div>
  )
}
