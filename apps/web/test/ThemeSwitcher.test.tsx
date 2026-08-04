import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

// jsdom has no matchMedia; the theme module resolves `system` through it.
let osPrefersDark = false
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('prefers-color-scheme: dark') ? osPrefersDark : false
  },
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

const root = () => document.documentElement
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

beforeEach(() => {
  localStorage.clear()
  osPrefersDark = false
  root().classList.remove('dark', 'light')
})

describe('ThemeSwitcher', () => {
  it('renders three segments with system active by default', () => {
    render(<ThemeSwitcher />)
    expect(pressed('System')).toBe('true')
    expect(pressed('Light')).toBe('false')
    expect(pressed('Dark')).toBe('false')
  })

  it('selecting dark applies the theme, stores the choice, and moves pressed state', () => {
    render(<ThemeSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(root().classList.contains('dark')).toBe(true)
    expect(pressed('Dark')).toBe('true')
    expect(pressed('System')).toBe('false')
  })

  it('an explicit light choice wins over an OS-dark preference (AE2)', () => {
    osPrefersDark = true
    render(<ThemeSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(root().classList.contains('light')).toBe(true)
    expect(root().classList.contains('dark')).toBe(false)
  })

  it('clicking the active segment is a no-op', () => {
    localStorage.setItem('theme', 'dark')
    render(<ThemeSwitcher />)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('exposes a labelled group of native buttons (keyboard-operable)', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy()
    screen.getAllByRole('button').forEach((b) => expect(b.tagName).toBe('BUTTON'))
  })
})
