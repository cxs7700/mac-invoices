import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Sidebar } from './Sidebar'
import { useLogout } from '@/hooks/useAuth'

/** Authenticated layout: sidebar (desktop) + a mobile top bar + content area. */
export function AppShell({ children }: { children: ReactNode }) {
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <span className="font-bold text-foreground">Rent Ops</span>
          <button
            type="button"
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
            }
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Log out
          </button>
        </header>
        <main className="flex-1 overflow-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
