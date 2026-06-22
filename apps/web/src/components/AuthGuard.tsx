import { Navigate, Outlet } from 'react-router'
import { useMe } from '@/hooks/useAuth'

/**
 * Gates the authenticated app. While the session check is in flight, shows a
 * splash; a missing/invalid session (or any /auth/me error) sends the user to
 * /login rather than into the app.
 */
export function AuthGuard() {
  const { data, isPending, isError } = useMe()

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading Rent Ops…</span>
      </div>
    )
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
