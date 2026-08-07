import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'

export type InvoiceItem = {
  id: string
  description: string
  quantity: number
  total: string
  sortOrder: number
}

export type InvoiceListItem = {
  id: string
  // Nullable: a vendor submission is unnumbered/uncategorized until the
  // landlord approves/categorizes it on review.
  invoiceNumber: string | null
  vendorName: string
  vendorEmail: string | null
  // Itemized line list, ordered by sortOrder — replaces the old single
  // `description` field. `amount` is the server-computed sum of item totals.
  items: InvoiceItem[]
  amount: string
  category: string | null
  status: string
  invoiceDate: string
  // The raw scalar (the list join stops at user/_count); the PDF export
  // resolves it to an address against the properties list.
  propertyId: string | null
  partsOrdered: string | null
  updatedAt: string
  sheetsSyncedAt: string | null
  // Number of attached photos (from the API _count) — drives the add-photo
  // indicator without fetching the image rows.
  imageCount: number
  // Attribution vendor — "who this invoice is from" (PDF Sender section).
  // Set on every landlord-entered invoice with a resolved/auto-created vendor,
  // and on a self-submission too; the PDF falls back to vendorName/vendorEmail
  // only when this is null (no vendor could be resolved).
  vendor: { name: string; phone: string | null; email: string | null } | null
}

export type InvoiceListResponse = {
  data: InvoiceListItem[]
  pagination: { total: number; limit: number; offset: number }
}

export type InvoiceListParams = {
  status?: string
  from?: string
  to?: string
  vendor?: string
  search?: string
  propertyId?: string
  sort?: string
  order?: string
  limit?: number
  offset?: number
}

/** The session user's invoices (status/date/vendor/search filter, sort, pagination). */
export function useInvoices(params: InvoiceListParams) {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.vendor) qs.set('vendor', params.vendor)
  if (params.search) qs.set('search', params.search)
  if (params.propertyId) qs.set('propertyId', params.propertyId)
  if (params.sort) qs.set('sort', params.sort)
  if (params.order) qs.set('order', params.order)
  qs.set('limit', String(params.limit ?? 20))
  qs.set('offset', String(params.offset ?? 0))

  return useQuery<InvoiceListResponse>({
    queryKey: ['invoices', params],
    queryFn: () => apiClient<InvoiceListResponse>(`/api/invoices?${qs.toString()}`),
    placeholderData: keepPreviousData,
    // A 401/4xx shouldn't be retried (matches useInvoice/useMe); the global
    // default is retry:1, which would double a doomed request.
    retry: false,
  })
}
