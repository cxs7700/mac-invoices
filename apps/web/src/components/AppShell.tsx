import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PanelLeftOpen } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { NavLinks } from './NavLinks'
import { NotificationsBell } from './NotificationsBell'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useLogout } from '@/hooks/useAuth'

const SIDEBAR_HIDDEN_KEY = 'sidebarHidden'

function getStoredSidebarHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function storeSidebarHidden(hidden: boolean) {
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(hidden))
  } catch {
    // A blocked localStorage (private mode, disabled cookies) must not break
    // the toggle — it just will not survive a reload.
  }
}

/** Authenticated layout: sidebar (desktop, collapsible) + a mobile top bar with
 * a slide-out nav drawer + content area. */
export function AppShell({ children }: { children: ReactNode }) {
  const logout = useLogout()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Device-local, like the theme preference (DEC-025): a layout choice belongs
  // to the screen you are sitting at, not to the account.
  const [sidebarHidden, setSidebarHidden] = useState(getStoredSidebarHidden)
  const doLogout = () =>
    logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })

  const toggleSidebar = () => {
    setSidebarHidden((hidden) => {
      const next = !hidden
      storeSidebarHidden(next)
      return next
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!sidebarHidden && <Sidebar onHide={toggleSidebar} />}
      <div className="flex-1 flex flex-col min-w-0">
        {sidebarHidden && (
          <div className="hidden md:flex print:hidden shrink-0 items-center gap-2 px-4 pt-4">
            <button
              type="button"
              aria-label={t('common.showSidebar')}
              aria-expanded={false}
              onClick={toggleSidebar}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="font-bold text-foreground">{t('app.name')}</span>
          </div>
        )}
        <header className="md:hidden print:hidden flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('common.openMenu')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="rounded-md p-1 text-foreground hover:bg-accent"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                aria-hidden
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
              </svg>
            </button>
            <span className="font-bold text-foreground">{t('app.name')}</span>
          </div>
          {/* The theme switcher lives in the drawer on mobile, not here: five
              controls do not fit across 375px, and the squeeze clipped its own
              last segment. `shrink-0` keeps the rest from being squeezed too. */}
          <div className="flex shrink-0 items-center gap-3">
            <LanguageSwitcher persist />
            <NotificationsBell />
            <button
              type="button"
              onClick={doLogout}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('common.logOut')}
            </button>
          </div>
        </header>

        {drawerOpen && (
          <div
            className="md:hidden fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            aria-label={t('common.menu')}
          >
            <div
              className="absolute inset-0 bg-overlay"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar border-r border-sidebar-border">
              <div className="flex items-center justify-between px-4 py-4">
                <span className="text-lg font-bold text-foreground">{t('app.name')}</span>
                <button
                  type="button"
                  aria-label={t('common.closeMenu')}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent"
                >
                  ✕
                </button>
              </div>
              <NavLinks onNavigate={() => setDrawerOpen(false)} />
              <div className="border-t border-sidebar-border p-3">
                <ThemeSwitcher />
              </div>
              <div className="border-t border-sidebar-border p-3">
                <button
                  type="button"
                  onClick={doLogout}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('common.logOut')}
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
