import { describe, it, expect, beforeEach, vi } from 'vitest'

// Controllable matchMedia stub: tests flip `osPrefersDark` and fire `emitChange`
// to simulate the OS switching theme while the app is open.
type ChangeListener = (e: { matches: boolean }) => void
let osPrefersDark = false
let changeListeners: ChangeListener[] = []

vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('prefers-color-scheme: dark') ? osPrefersDark : false
  },
  media: query,
  addEventListener: (_: 'change', fn: ChangeListener) => changeListeners.push(fn),
  removeEventListener: (_: 'change', fn: ChangeListener) => {
    changeListeners = changeListeners.filter((l) => l !== fn)
  },
}))

const emitChange = () => changeListeners.forEach((fn) => fn({ matches: osPrefersDark }))

import { getStoredTheme, resolveTheme, setTheme, applyTheme, initTheme } from '@/lib/theme'

const root = () => document.documentElement
const themeColorMeta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')

beforeEach(() => {
  localStorage.clear()
  osPrefersDark = false
  changeListeners = []
  root().classList.remove('dark', 'light')
  themeColorMeta()?.remove()
  initTheme()
})

describe('theme resolution', () => {
  it('stored dark on an OS-light device resolves dark (AE5)', () => {
    localStorage.setItem('theme', 'dark')
    applyTheme(getStoredTheme())
    expect(root().classList.contains('dark')).toBe(true)
    expect(root().classList.contains('light')).toBe(false)
  })

  it('stored light on an OS-dark device resolves light (AE2)', () => {
    osPrefersDark = true
    localStorage.setItem('theme', 'light')
    applyTheme(getStoredTheme())
    expect(root().classList.contains('light')).toBe(true)
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('stored system resolves from the OS preference', () => {
    osPrefersDark = true
    localStorage.setItem('theme', 'system')
    expect(resolveTheme(getStoredTheme())).toBe('dark')
    osPrefersDark = false
    expect(resolveTheme(getStoredTheme())).toBe('light')
  })

  it('a missing stored value resolves as system', () => {
    osPrefersDark = true
    expect(getStoredTheme()).toBe('system')
    expect(resolveTheme(getStoredTheme())).toBe('dark')
  })

  it('an invalid stored value resolves as system', () => {
    localStorage.setItem('theme', 'blue')
    expect(getStoredTheme()).toBe('system')
  })
})

describe('live OS follow', () => {
  it('with system selected, an OS change re-applies the theme without reload (AE3)', () => {
    setTheme('system')
    expect(root().classList.contains('dark')).toBe(false)
    osPrefersDark = true
    emitChange()
    expect(root().classList.contains('dark')).toBe(true)
  })

  it('with an explicit choice, an OS change does nothing', () => {
    setTheme('light')
    osPrefersDark = true
    emitChange()
    expect(root().classList.contains('light')).toBe(true)
    expect(root().classList.contains('dark')).toBe(false)
  })
})

describe('applying a theme', () => {
  it('updates the root class and the theme-color meta together', () => {
    setTheme('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(themeColorMeta()?.content).toBe('#10151c')
    setTheme('light')
    expect(root().classList.contains('light')).toBe(true)
    expect(themeColorMeta()?.content).toBe('#eef1f5')
  })

  it('setTheme stores the choice; system is stored as system, not resolved', () => {
    setTheme('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    setTheme('system')
    expect(localStorage.getItem('theme')).toBe('system')
  })
})
