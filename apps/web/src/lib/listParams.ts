import { InvoiceStatus, InvoiceSortField, SortOrder } from '@mac-invoices/shared'
import type { InvoiceListParams } from '@/hooks/useInvoices'

// Phase 4 keeps the Phase 3 page size. URL carries 1-based `page`; the API takes
// `offset` (KTD-4/KTD-6), converted here.
export const PAGE_SIZE = 20
// Offset ceiling enforced by ListInvoicesQuerySchema; clamp here so a hand-edited
// ?page never derives an out-of-bounds offset and 400s (KTD-7).
const MAX_OFFSET = 100_000

// Derived from the shared schema so the allowlist + order never drift from the API.
export const STATUS_OPTIONS = InvoiceStatus.options
export const SORT_OPTIONS = InvoiceSortField.options
const ORDER_OPTIONS = SortOrder.options
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Relative date-range shortcuts offered in place of a raw from/to pair. The
 * from date is derived at query time (see `rangeStart`) so a bookmarked
 * `?range=1m` keeps meaning "the last month" tomorrow, not a frozen window.
 */
export const DATE_RANGE_PRESETS = ['1w', '1m', '3m', '6m', 'ytd', '1y'] as const
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number]
/** The escape hatch: pick explicit from/to dates instead of a preset. */
export const CUSTOM_RANGE = 'custom'
const RANGE_OPTIONS: readonly string[] = [...DATE_RANGE_PRESETS, CUSTOM_RANGE]

const pad = (n: number) => String(n).padStart(2, '0')
/** Local-time YYYY-MM-DD (toISOString would shift the day in western zones). */
const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Month arithmetic without JS's overflow (Mar 31 − 1mo → Feb 28, not Mar 3). */
function minusMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() - months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), lastDay))
  return target
}

/**
 * The `from` date a preset resolves to. Presets deliberately leave `to` open —
 * they mean "since X", so a same-day or future-dated invoice never disappears
 * behind an upper bound.
 */
export function rangeStart(preset: DateRangePreset, today: Date = new Date()): string {
  switch (preset) {
    case '1w': {
      const d = new Date(today)
      d.setDate(d.getDate() - 7)
      return toISODate(d)
    }
    case '1m':
      return toISODate(minusMonths(today, 1))
    case '3m':
      return toISODate(minusMonths(today, 3))
    case '6m':
      return toISODate(minusMonths(today, 6))
    case 'ytd':
      return toISODate(new Date(today.getFullYear(), 0, 1))
    case '1y':
      return toISODate(minusMonths(today, 12))
  }
}

export type ListFilters = {
  status: string
  // A preset key, 'custom', or '' for no date filter. When it isn't 'custom'
  // the from/to fields are unused — the window is derived from the preset.
  range: string
  from: string
  to: string
  vendor: string
  search: string // free-text over job description
  propertyId: string // a property id, or "none" for the unassigned bucket
  sort: string
  order: string
  page: number // 1-based
}

const oneOf = (value: string, allowed: readonly string[], fallback: string) =>
  allowed.includes(value) ? value : fallback

/**
 * Read + sanitize the list filters from the URL. Garbage values (hand-edited
 * URLs) fall back to defaults rather than reaching — and 400ing — the API
 * (KTD-7: strict API, sanitizing client).
 */
export function parseListParams(sp: URLSearchParams): ListFilters {
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const status = sp.get('status') ?? ''
  const rangeRaw = sp.get('range') ?? ''
  const pageRaw = parseInt(sp.get('page') ?? '1', 10)
  // A bare ?from=/?to= (older bookmark, hand-edited URL) still works: it implies
  // the custom range, which is the only mode that reads those two fields.
  const range = RANGE_OPTIONS.includes(rangeRaw)
    ? rangeRaw
    : DATE_RE.test(from) || DATE_RE.test(to)
      ? CUSTOM_RANGE
      : ''
  return {
    status: (STATUS_OPTIONS as readonly string[]).includes(status) ? status : '',
    range,
    from: range === CUSTOM_RANGE && DATE_RE.test(from) ? from : '',
    to: range === CUSTOM_RANGE && DATE_RE.test(to) ? to : '',
    vendor: (sp.get('vendor') ?? '').trim(),
    search: (sp.get('search') ?? '').trim(),
    // A property id is dynamic (not an allowlist); "none" is the unassigned bucket.
    propertyId: (sp.get('propertyId') ?? '').trim(),
    sort: oneOf(sp.get('sort') ?? '', SORT_OPTIONS, 'invoiceDate'),
    order: oneOf(sp.get('order') ?? '', ORDER_OPTIONS, 'desc'),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}

/** The concrete from/to a filter set resolves to (a preset derives its start). */
export function resolvedDates(f: ListFilters, today: Date = new Date()) {
  if (f.range && f.range !== CUSTOM_RANGE) {
    return { from: rangeStart(f.range as DateRangePreset, today), to: '' }
  }
  return { from: f.from, to: f.to }
}

/** Sanitized filters → `useInvoices` params (drop empties + defaults, page→offset). */
export function toQueryParams(f: ListFilters): InvoiceListParams {
  const { from, to } = resolvedDates(f)
  return {
    status: f.status || undefined,
    from: from || undefined,
    to: to || undefined,
    vendor: f.vendor || undefined,
    search: f.search || undefined,
    propertyId: f.propertyId || undefined,
    // Omit defaults so the query string / cache key stays minimal.
    sort: f.sort !== 'invoiceDate' ? f.sort : undefined,
    order: f.order !== 'desc' ? f.order : undefined,
    limit: PAGE_SIZE,
    offset: Math.min((f.page - 1) * PAGE_SIZE, MAX_OFFSET),
  }
}

/** Filters → URLSearchParams to write (omit defaults to keep the URL clean). */
export function toSearchParams(f: ListFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.status) sp.set('status', f.status)
  if (f.range) sp.set('range', f.range)
  // Only the custom range carries dates; a preset's window is derived, not stored.
  if (f.range === CUSTOM_RANGE && f.from) sp.set('from', f.from)
  if (f.range === CUSTOM_RANGE && f.to) sp.set('to', f.to)
  if (f.vendor) sp.set('vendor', f.vendor)
  if (f.search) sp.set('search', f.search)
  if (f.propertyId) sp.set('propertyId', f.propertyId)
  if (f.sort !== 'invoiceDate') sp.set('sort', f.sort)
  if (f.order !== 'desc') sp.set('order', f.order)
  if (f.page > 1) sp.set('page', String(f.page))
  return sp
}

export function hasActiveFilters(f: ListFilters): boolean {
  return Boolean(f.status || f.range || f.vendor || f.search || f.propertyId)
}
