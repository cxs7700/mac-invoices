import { Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'

type NavItem = { key: string; to?: string; match?: (path: string) => boolean }

const NAV: NavItem[] = [
  { key: 'dashboard', to: '/dashboard', match: (p) => p === '/' || p.startsWith('/dashboard') },
  { key: 'invoices', to: '/invoices', match: (p) => p.startsWith('/invoices') },
  { key: 'properties', to: '/properties', match: (p) => p.startsWith('/properties') },
  { key: 'vendors', to: '/vendors', match: (p) => p.startsWith('/vendors') },
  { key: 'settings', to: '/settings', match: (p) => p.startsWith('/settings') },
]

/** The app's primary nav, shared by the desktop sidebar and the mobile drawer.
 * `onNavigate` fires on a link click (so the drawer can close). Items without a
 * `to` render as disabled "Soon" stubs. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  return (
    <nav className="flex-1 space-y-1 px-2">
      {NAV.map((item) =>
        item.to ? (
          <Link
            key={item.key}
            to={item.to}
            onClick={onNavigate}
            className={`flex items-center rounded-md px-3 py-2 text-sm font-medium ${
              item.match?.(pathname)
                ? 'bg-accent text-accent-foreground border-l-2 border-primary'
                : 'text-sidebar-foreground hover:bg-accent'
            }`}
          >
            {t(`nav.${item.key}`)}
          </Link>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            tabIndex={-1}
            className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60"
          >
            {t(`nav.${item.key}`)}
            <span className="text-[10px] uppercase tracking-wide">{t('nav.soon')}</span>
          </span>
        ),
      )}
    </nav>
  )
}
