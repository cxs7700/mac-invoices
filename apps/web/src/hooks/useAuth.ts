import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, SignupInput } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

export type AuthUser = {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  role: string
  locale: string
}

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

/**
 * Signup logs the new user straight in — the endpoint issues a session and
 * returns login's response shape, so the cache seeding is identical.
 */
export function useSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SignupInput) =>
      apiClient<AuthUser>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  })
}

/** Consume an operator-issued reset link. No session involved — the token is
 *  the authorization, and a 204 means the password is set. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; newPassword: string }) =>
      apiClient<void>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient('/api/auth/logout', { method: 'POST' }),
    // onSettled (not onSuccess): even if the logout request fails, drop the
    // cached session + invoice data so it can't leak to the next user.
    onSettled: () => {
      queryClient.setQueryData(['me'], null)
      queryClient.clear()
    },
  })
}
