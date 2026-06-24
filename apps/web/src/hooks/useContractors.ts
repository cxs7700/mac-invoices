import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Contractor, ContractorWithLink, CreateContractorInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// Landlord-side contractor management. The plaintext link is present only on the
// create/regenerate responses (ContractorWithLink) — the list never carries it.

export function useContractors() {
  return useQuery<{ data: Contractor[] }>({
    queryKey: ['contractors'],
    queryFn: () => apiClient('/api/contractors'),
    retry: false,
  })
}

export function useCreateContractor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateContractorInput) =>
      apiClient<ContractorWithLink>('/api/contractors', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contractors'] }),
  })
}

export function useRevokeLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient<Contractor>(`/api/contractors/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contractors'] }),
  })
}

export function useRegenerateLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<ContractorWithLink>(`/api/contractors/${id}/regenerate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contractors'] }),
  })
}
