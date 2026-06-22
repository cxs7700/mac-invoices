import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateInvoiceInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'
import type { InvoiceListItem } from './useInvoices'

export type Invoice = InvoiceListItem & {
  vendorEmail: string | null
  currency: string
  propertyId: string | null
  paidDate: string | null
  notes: string | null
  attachmentUrl: string | null
  createdAt: string
  updatedAt: string
  user?: { id: string; name: string | null; email: string }
}

export function useInvoice(id: string | undefined) {
  return useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn: () => apiClient<Invoice>(`/api/invoices/${id}`),
    enabled: !!id,
    retry: false,
  })
}

export function useUpdateInvoice(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateInvoiceInput) =>
      apiClient<Invoice>(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient(`/api/invoices/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  })
}
