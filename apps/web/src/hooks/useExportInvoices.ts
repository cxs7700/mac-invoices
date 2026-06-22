import { useMutation } from '@tanstack/react-query'
import type { ExportInvoicesResult } from '@mac-invoices/shared'
import { apiClient, ApiError } from '@/lib/apiClient'

/**
 * Triggers the Sheets export (POST /api/invoices/export, env-default sheet).
 * No cache invalidation — `sheetsSyncedAt` isn't surfaced in the list/stats today.
 */
export function useExportInvoices() {
  return useMutation<ExportInvoicesResult, ApiError>({
    mutationFn: () =>
      apiClient<ExportInvoicesResult>('/api/invoices/export', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  })
}
