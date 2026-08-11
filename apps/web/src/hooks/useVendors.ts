import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Vendor,
  VendorWithLink,
  CreateVendorInput,
  UpdateVendorInput,
} from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'
import type { SubmissionProperty } from '@/hooks/useSubmission'

// Landlord-side vendor management. Every vendor response carries the current
// submission link, derived server-side (DEC-034), so the list can offer copy
// on any row rather than only right after creation.

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

/** Replace a revoked vendor's link (bumps the server-side token version). */
export function useReissueLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<VendorWithLink>(`/api/vendors/${id}/regenerate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useDeleteVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient<void>(`/api/vendors/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

/**
 * The properties assigned to one vendor — the exact set their submission link
 * offers. Enabled-gated so the list page only fetches for the row the landlord
 * actually expands.
 */
export function useVendorProperties(id: string, enabled = true) {
  return useQuery<{ data: SubmissionProperty[] }>({
    queryKey: ['vendors', id, 'properties'],
    queryFn: () => apiClient(`/api/vendors/${id}/properties`),
    enabled,
    retry: false,
  })
}

/** Replace a vendor's whole property assignment (see SetVendorPropertiesSchema). */
export function useSetVendorProperties(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (propertyIds: string[]) =>
      apiClient<{ data: SubmissionProperty[] }>(`/api/vendors/${id}/properties`, {
        method: 'PUT',
        body: JSON.stringify({ propertyIds }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendors', id, 'properties'] })
      // The list row shows propertyCount, so it has to refetch too.
      void qc.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateVendorInput & { id: string }) =>
      apiClient<Vendor>(`/api/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}
