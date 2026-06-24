import { useQuery } from '@tanstack/react-query'
import type { InvoiceStatus, InvoiceCategory } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export type InvoiceSummary = {
  total: { count: number; amount: string }
  byCategory: { category: InvoiceCategory; count: number; amount: string }[]
  byStatus: { status: InvoiceStatus; count: number; amount: string }[]
}

/** All-time spend totals (grand total + per-category + per-status) for the dashboard. */
export function useInvoiceSummary() {
  return useQuery<InvoiceSummary>({
    queryKey: ['invoice-summary'],
    queryFn: () => apiClient<InvoiceSummary>('/api/invoices/summary'),
    retry: false,
    staleTime: 30_000,
  })
}
