import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { InvoiceImage, ImageType } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// The landlord photo gallery talks to the `/:id/images` collection. Each mutation
// invalidates the gallery AND the invoice (its imageCount drives the add-photo
// indicator) plus the timeline (attach/remove append ledger events).
function invalidate(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: ['invoice-images', id] })
  qc.invalidateQueries({ queryKey: ['invoice', id] })
  qc.invalidateQueries({ queryKey: ['invoices'] })
  qc.invalidateQueries({ queryKey: ['invoice-events', id] })
}

/** An invoice's photos (each with a freshly-signed view URL). */
export function useInvoiceImages(id: string | undefined) {
  return useQuery<{ data: InvoiceImage[] }>({
    queryKey: ['invoice-images', id],
    queryFn: () => apiClient(`/api/invoices/${id}/images`),
    enabled: !!id,
    retry: false,
  })
}

/** Append a photo (its blob already uploaded) to the gallery. */
export function useAddInvoiceImage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) =>
      apiClient(`/api/invoices/${id}/images`, { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: () => invalidate(qc, id),
  })
}

/** Remove one photo by id (permanent — also reclaims the blob server-side). */
export function useRemoveInvoiceImage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (imageId: string) =>
      apiClient(`/api/invoices/${id}/images/${imageId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc, id),
  })
}

/** Change one photo's type (cash / parts / check / other). */
export function useSetInvoiceImageType(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ imageId, type }: { imageId: string; type: ImageType }) =>
      apiClient(`/api/invoices/${id}/images/${imageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type }),
      }),
    onSuccess: () => invalidate(qc, id),
  })
}
