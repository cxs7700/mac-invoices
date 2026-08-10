import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { AuthGuard } from '@/components/AuthGuard'
import i18n from '@/lib/i18n'

const mutate = vi.fn()
const { useMe } = vi.hoisted(() => ({ useMe: vi.fn() }))
vi.mock('@/hooks/useSettings', () => ({ useUpdateProfile: () => ({ mutate }) }))
vi.mock('@/hooks/useAuth', () => ({ useMe }))

beforeEach(() => {
  vi.clearAllMocks()
  useMe.mockReturnValue({ data: { locale: 'en' }, isPending: false, isError: false })
})
afterEach(() => i18n.changeLanguage('en'))

describe('LanguageSwitcher', () => {
  it('persists the choice when persist is set (chrome)', async () => {
    render(<LanguageSwitcher persist />)
    fireEvent.click(screen.getByRole('button', { name: '粵語' }))
    expect(mutate).toHaveBeenCalledWith({ locale: 'zh' })
    await waitFor(() => expect(i18n.language).toBe('zh'))
  })

  it('switches without persisting when persist is omitted (public vendor page)', async () => {
    render(<LanguageSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: '粵語' }))
    expect(mutate).not.toHaveBeenCalled()
    await waitFor(() => expect(i18n.language).toBe('zh'))
  })
})

describe('AuthGuard locale reconcile', () => {
  it('reconciles the UI language to the server preference on load', async () => {
    useMe.mockReturnValue({ data: { locale: 'zh' }, isPending: false, isError: false })
    expect(i18n.language).toBe('en')
    render(
      <MemoryRouter>
        <AuthGuard />
      </MemoryRouter>,
    )
    await waitFor(() => expect(i18n.language).toBe('zh'))
  })
})
