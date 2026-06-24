import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ExportInvoicesResult } from '@mac-invoices/shared'
import { apiClient, ApiError } from '@/lib/apiClient'

/**
 * Triggers the Sheets export (POST /api/invoices/export, env-default sheet).
 * On success, invalidates the invoice queries so the per-invoice sync badges
 * (`sheetsSyncedAt`) refresh from "Not exported" to "Exported".
 */
export function useExportInvoices() {
  const queryClient = useQueryClient()
  return useMutation<ExportInvoicesResult, ApiError>({
    mutationFn: () =>
      apiClient<ExportInvoicesResult>('/api/invoices/export', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['invoice'] })
    },
  })
}
