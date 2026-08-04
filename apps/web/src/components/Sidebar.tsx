import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { NavLinks } from './NavLinks'
import { NotificationsBell } from './NotificationsBell'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useMe, useLogout } from '@/hooks/useAuth'

export function Sidebar() {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <aside
      data-rnav
      className="hidden md:flex print:hidden w-56 shrink-0 flex-col overflow-y-auto bg-sidebar border-r border-sidebar-border"
    >
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-lg font-bold text-foreground">{t('app.name')}</span>
        <NotificationsBell />
      </div>

      <NavLinks />

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <LanguageSwitcher persist />
          <ThemeSwitcher />
        </div>
        <div className="mt-2 truncate text-sm text-foreground">{me.data?.name ?? me.data?.email}</div>
        <button
          type="button"
          onClick={() =>
            logout.mutate(undefined, { onSuccess: () => navigate('/login', { replace: true }) })
          }
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  )
}
