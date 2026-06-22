import { Navigate, Outlet } from 'react-router'
import { useMe } from '@/hooks/useAuth'
import { ApiError } from '@/lib/apiClient'

/**
 * Gates the authenticated app. While the session check is in flight, shows a
 * splash. A genuine 401 sends the user to /login; a transient failure (5xx,
 * network) shows a reconnecting state with retry instead of silently logging
 * an authenticated user out and discarding in-progress work.
 */
export function AuthGuard() {
  const { data, isPending, isError, error, refetch } = useMe()

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading Rent Ops…</span>
      </div>
    )
  }

  const isUnauthorized = error instanceof ApiError && error.status === 401

  if (isUnauthorized || (!isError && !data)) {
    return <Navigate to="/login" replace />
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <span className="text-sm text-muted-foreground">Couldn't reach the server.</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  return <Outlet />
}
