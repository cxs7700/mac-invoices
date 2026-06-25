import { Link, useLocation } from 'react-router'

type NavItem = { label: string; to?: string; match?: (path: string) => boolean }

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', match: (p) => p === '/' || p.startsWith('/dashboard') },
  { label: 'Invoices', to: '/invoices', match: (p) => p.startsWith('/invoices') },
  { label: 'Expenses' },
  { label: 'Properties', to: '/properties', match: (p) => p.startsWith('/properties') },
  { label: 'Contractors', to: '/contractors', match: (p) => p.startsWith('/contractors') },
  { label: 'Settings', to: '/settings', match: (p) => p.startsWith('/settings') },
]

/** The app's primary nav, shared by the desktop sidebar and the mobile drawer.
 * `onNavigate` fires on a link click (so the drawer can close). Items without a
 * `to` render as disabled "Soon" stubs. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <nav className="flex-1 space-y-1 px-2">
      {NAV.map((item) =>
        item.to ? (
          <Link
            key={item.label}
            to={item.to}
            onClick={onNavigate}
            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium ${
              item.match?.(pathname)
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
  )
}
