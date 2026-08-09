import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedSwitcher } from './SegmentedSwitcher'
import { getStoredTheme, setTheme, subscribeTheme, type Theme } from '@/lib/theme'

const THEMES = ['light', 'system', 'dark'] as const

// 20-viewBox stroke icons per the chrome convention (NotificationsBell).
const ICONS: Record<Theme, ReturnType<typeof SunIcon>> = {
  light: SunIcon(),
  system: MonitorIcon(),
  dark: MoonIcon(),
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="3.5" />
      <path
        d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
      <path d="M7.5 17h5M10 14v3" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7Z" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Tri-state theme toggle (light / system / dark), device-local (DEC-025).
 * The stored value is the tri-state choice; `system` follows the OS live.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const theme = useSyncExternalStore(subscribeTheme, getStoredTheme)

  return (
    <SegmentedSwitcher
      options={THEMES}
      value={theme}
      onChange={setTheme}
      label={t('settings.theme.title')}
      renderOption={(option) => ICONS[option]}
      optionLabel={(option) => t(`settings.theme.${option}`)}
    />
  )
}
