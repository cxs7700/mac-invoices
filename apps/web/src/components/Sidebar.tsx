import { Link, useLocation, useNavigate } from 'react-router'
import { useMe, useLogout } from '@/hooks/useAuth'

const NAV: { label: string; to?: string }[] = [
  { label: 'Invoices', to: '/invoices' },
  { label: 'Dashboard' },
  { label: 'Expenses' },
  { label: 'Properties' },
  { label: 'Contractors' },
  { label: 'Settings' },
]

export function Sidebar() {
  const location = useLocation()
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  const invoicesActive = location.pathname === '/' || location.pathname.startsWith('/invoices')

  return (
    <aside
      data-rnav
      className="hidden md:flex w-56 shrink-0 flex-col bg-sidebar border-r border-sidebar-border"
    >
      <div className="px-4 py-4 text-lg font-bold text-foreground">Rent Ops</div>

      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) =>
          item.to ? (
            <Link
              key={item.label}
              to={item.to}
              className={`flex items-center rounded-md px-3 py-2 text-sm font-medium ${
                invoicesActive
                  ? 'bg-accent text-accent-foreground border-l-2 border-primary'
                  : 'text-sidebar-foreground hover:bg-accent'
              }`}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.label}
              aria-disabled="true"
              tabIndex={-1}
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60"
            >
              {item.label}
              <span className="text-[10px] uppercase tracking-wide">Soon</span>
            </span>
          ),
        )}
      </nav>

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
