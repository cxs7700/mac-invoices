import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/apiClient'

/** Fetches API liveness from /api/health. Drives the layout's status indicator. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient<{ status: string }>('/api/health'),
  })
}
