import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Property,
  PropertyDetail,
  CreatePropertyInput,
  UpdatePropertyInput,
} from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// Landlord-side property management. Per-landlord; the API scopes everything to
// the session user. The list and the single-resource detail share the
// ['properties'] query-key prefix so a mutation invalidates both.

export function useProperties() {
  return useQuery<{ data: Property[] }>({
    queryKey: ['properties'],
    queryFn: () => apiClient('/api/properties'),
    retry: false,
  })
}

/** One property plus its spend rollup (PropertyDetail). */
export function useProperty(id: string) {
  return useQuery<PropertyDetail>({
    queryKey: ['properties', id],
    queryFn: () => apiClient(`/api/properties/${id}`),
    retry: false,
  })
}

export function useCreateProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePropertyInput) =>
      apiClient<Property>('/api/properties', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useUpdateProperty(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdatePropertyInput) =>
      apiClient<Property>(`/api/properties/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  })
}

export function useDeleteProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient(`/api/properties/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['properties'] }),
  })
}
