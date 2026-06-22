import { useQuery } from '@tanstack/react-query'
import type { InvoiceStatus } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export type InvoiceStats = {
  counts: Record<InvoiceStatus, number>
  total: number
}

/** All-time totals by status for the session user (read-only dashboard strip). */
export function useInvoiceStats() {
  return useQuery<InvoiceStats>({
    queryKey: ['invoice-stats'],
    queryFn: () => apiClient<InvoiceStats>('/api/invoices/stats'),
    retry: false,
    staleTime: 30_000,
  })
}
