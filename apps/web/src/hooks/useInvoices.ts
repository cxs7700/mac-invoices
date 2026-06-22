import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'

export type InvoiceListItem = {
  id: string
  invoiceNumber: string
  vendorName: string
  description: string
  amount: string
  category: string
  status: string
  invoiceDate: string
  dueDate: string | null
}

export type InvoiceListResponse = {
  data: InvoiceListItem[]
  pagination: { total: number; limit: number; offset: number }
}

export type InvoiceListParams = { status?: string; limit?: number; offset?: number }

/** The session user's invoices (status filter + offset pagination). */
export function useInvoices(params: InvoiceListParams) {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  search.set('limit', String(params.limit ?? 20))
  search.set('offset', String(params.offset ?? 0))

  return useQuery<InvoiceListResponse>({
    queryKey: ['invoices', params],
    queryFn: () => apiClient<InvoiceListResponse>(`/api/invoices?${search.toString()}`),
    placeholderData: keepPreviousData,
    // A 401/4xx shouldn't be retried (matches useInvoice/useMe); the global
    // default is retry:1, which would double a doomed request.
    retry: false,
  })
}
