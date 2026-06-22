import { useRef, useState } from 'react'
import {
  STATUS_OPTIONS,
  SORT_OPTIONS,
  hasActiveFilters,
  type ListFilters,
} from '@/lib/listParams'

const field =
  'rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const SORT_LABELS: Record<string, string> = {
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
  // Local mirror of the vendor text so we can debounce before lifting it up.
  const [vendor, setVendor] = useState(filters.vendor)
  const [syncedVendor, setSyncedVendor] = useState(filters.vendor)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Re-sync the input when the URL vendor changes externally (e.g. clear-all),
  // adjusting state during render rather than in an effect.
  if (filters.vendor !== syncedVendor) {
    setSyncedVendor(filters.vendor)
    setVendor(filters.vendor)
  }

  const handleVendor = (value: string) => {
    setVendor(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange({ vendor: value }), 300)
  }

  const dateError = filters.from && filters.to && filters.from > filters.to

  return (
    <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
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
