import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export type AuthUser = { id: string; email: string; name: string | null; role: string }

/** The current session user, or an error (401) when not logged in. */
export function useMe() {
  return useQuery<AuthUser>({
    queryKey: ['me'],
    queryFn: () => apiClient<AuthUser>('/api/auth/me'),
    retry: false,
    staleTime: 60_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (creds: LoginInput) =>
      apiClient<AuthUser>('/api/auth/login', { method: 'POST', body: JSON.stringify(creds) }),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null)
      queryClient.clear()
    },
  })
}
