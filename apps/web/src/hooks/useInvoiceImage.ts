import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'

function invalidateImage(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: ['invoice', id] })
  qc.invalidateQueries({ queryKey: ['invoice-image', id] })
  qc.invalidateQueries({ queryKey: ['invoice-events', id] })
}

/** The current signed view URL for an invoice's photo. 404 (isError) means no photo. */
export function useInvoiceImageUrl(id: string | undefined) {
  return useQuery<{ url: string }>({
    queryKey: ['invoice-image', id],
    queryFn: () => apiClient(`/api/invoices/${id}/image-url`),
    enabled: !!id,
    retry: false,
  })
}

export function useAttachInvoiceImage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) =>
      apiClient(`/api/invoices/${id}/image`, { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: () => invalidateImage(qc, id),
  })
}

export function useRemoveInvoiceImage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient(`/api/invoices/${id}/image`, { method: 'DELETE' }),
    onSuccess: () => invalidateImage(qc, id),
  })
}
