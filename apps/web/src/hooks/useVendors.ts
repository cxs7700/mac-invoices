import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Vendor, VendorWithLink, CreateVendorInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// Landlord-side vendor management. The plaintext link is present only on the
// create/regenerate responses (VendorWithLink) — the list never carries it.

export function useVendors() {
  return useQuery<{ data: Vendor[] }>({
    queryKey: ['vendors'],
    queryFn: () => apiClient('/api/vendors'),
    retry: false,
  })
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateVendorInput) =>
      apiClient<VendorWithLink>('/api/vendors', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useRevokeLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient<Vendor>(`/api/vendors/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useRegenerateLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<VendorWithLink>(`/api/vendors/${id}/regenerate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}
