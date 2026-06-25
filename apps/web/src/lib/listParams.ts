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

export type ListFilters = {
  status: string
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
  const pageRaw = parseInt(sp.get('page') ?? '1', 10)
  return {
    status: (STATUS_OPTIONS as readonly string[]).includes(status) ? status : '',
    from: DATE_RE.test(from) ? from : '',
    to: DATE_RE.test(to) ? to : '',
    vendor: (sp.get('vendor') ?? '').trim(),
    search: (sp.get('search') ?? '').trim(),
    // A property id is dynamic (not an allowlist); "none" is the unassigned bucket.
    propertyId: (sp.get('propertyId') ?? '').trim(),
    sort: oneOf(sp.get('sort') ?? '', SORT_OPTIONS, 'invoiceDate'),
    order: oneOf(sp.get('order') ?? '', ORDER_OPTIONS, 'desc'),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}

/** Sanitized filters → `useInvoices` params (drop empties + defaults, page→offset). */
export function toQueryParams(f: ListFilters): InvoiceListParams {
  return {
    status: f.status || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
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
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  if (f.vendor) sp.set('vendor', f.vendor)
  if (f.search) sp.set('search', f.search)
  if (f.propertyId) sp.set('propertyId', f.propertyId)
  if (f.sort !== 'invoiceDate') sp.set('sort', f.sort)
  if (f.order !== 'desc') sp.set('order', f.order)
  if (f.page > 1) sp.set('page', String(f.page))
  return sp
}

export function hasActiveFilters(f: ListFilters): boolean {
  return Boolean(f.status || f.from || f.to || f.vendor || f.search || f.propertyId)
}
