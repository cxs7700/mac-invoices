import { useNavigate } from 'react-router'
import { NavLinks } from './NavLinks'
import { NotificationsBell } from './NotificationsBell'
import { useMe, useLogout } from '@/hooks/useAuth'

export function Sidebar() {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <aside
      data-rnav
      className="hidden md:flex w-56 shrink-0 flex-col bg-sidebar border-r border-sidebar-border"
    >
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-lg font-bold text-foreground">Rent Ops</span>
        <NotificationsBell />
      </div>

      <NavLinks />

      <div className="border-t border-sidebar-border p-3">
        <div className="truncate text-sm text-foreground">{me.data?.name ?? me.data?.email}</div>
        <button
          type="button"
          onClick={() =>
            logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
          }
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Log out
        </button>
      </div>
    </aside>
  )
}
