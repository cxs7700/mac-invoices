import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateInvoiceInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

/** Creates an invoice via POST /api/invoices and refreshes the invoices cache. */
export function useCreateInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      apiClient('/api/invoices', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  })
}
