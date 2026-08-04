// Device-local theme preference (DEC-025): localStorage is the only store —
// no server field, no post-login reconcile. The inline script in index.html
// duplicates the resolve-and-stamp logic so first paint is correct before this
// bundle loads; keep the two in sync when changing resolution rules.

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
// Mirror --background in index.css (light-dark(#eef1f5, #10151c)).
const THEME_COLOR = { light: '#eef1f5', dark: '#10151c' } as const

type Listener = () => void
let listeners: Listener[] = []

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  return theme
}

/** Stamp the resolved theme on <html> (class drives color-scheme, which drives
 *  every light-dark() token) and keep the browser-chrome color in step. */
export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('light', resolved === 'light')
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = THEME_COLOR[resolved]
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Private mode etc. — the choice still applies for this page view.
  }
  applyTheme(theme)
  listeners.forEach((fn) => fn())
}

/** Subscribe to theme changes (for useSyncExternalStore). */
export function subscribeTheme(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

/** Wire the OS-preference listener: while the stored choice is `system`, the
 *  app follows OS theme changes live, without a reload. Call once at boot. */
export function initTheme() {
  matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system')
      listeners.forEach((fn) => fn())
    }
  })
}
