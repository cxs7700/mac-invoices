import { useQuery } from '@tanstack/react-query'
import type { InvoiceStatus, InvoiceCategory } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export type InvoiceSummary = {
  total: { count: number; amount: string }
  byCategory: { category: InvoiceCategory; count: number; amount: string }[]
  byStatus: { status: InvoiceStatus; count: number; amount: string }[]
  // One bucket per calendar month spanned by the window (gaps zero-filled),
  // oldest first. Empty when the window holds no spend.
  byMonth: { month: string; count: number; amount: string }[]
}

export type SummaryParams = { from?: string; to?: string }

/**
 * Spend totals (grand total + per-category + per-status + monthly trend) for the
 * dashboard. With no params it is the all-time summary; `from`/`to` narrow it to
 * the same invoiceDate window the invoice list filters by.
 */
export function useInvoiceSummary(params: SummaryParams = {}) {
  const qs = new URLSearchParams()
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''

  return useQuery<InvoiceSummary>({
    queryKey: ['invoice-summary', params.from ?? '', params.to ?? ''],
    queryFn: () => apiClient<InvoiceSummary>(`/api/invoices/summary${suffix}`),
    retry: false,
    staleTime: 30_000,
  })
}
