import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  UpdateProfileInput,
  ChangePasswordInput,
  SaveSheetInput,
  SheetsStatus,
  Account,
} from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateProfileInput) =>
      apiClient<Account>('/api/settings/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordInput) =>
      apiClient('/api/settings/password', { method: 'POST', body: JSON.stringify(body) }),
  })
}

export function useSheetsStatus() {
  return useQuery<SheetsStatus>({
    queryKey: ['sheets-status'],
    queryFn: () => apiClient('/api/settings/sheets'),
    retry: false,
  })
}

export function useSaveSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveSheetInput) =>
      apiClient<SheetsStatus>('/api/settings/sheets', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (status) => qc.setQueryData(['sheets-status'], status),
  })
}

export function useTestSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient<{ ok: boolean }>('/api/settings/sheets/test', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheets-status'] }),
  })
}
