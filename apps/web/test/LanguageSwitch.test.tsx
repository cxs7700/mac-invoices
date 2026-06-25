import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Settings from '@/pages/Settings'
import { AuthGuard } from '@/components/AuthGuard'
import i18n from '@/lib/i18n'

const h = vi.hoisted(() => ({
  useMe: vi.fn(),
  useUpdateProfile: vi.fn(),
  useChangePassword: vi.fn(),
  useSheetsStatus: vi.fn(),
  useSaveSheet: vi.fn(),
  useTestSheet: vi.fn(),
}))
vi.mock('@/hooks/useAuth', () => ({ useMe: h.useMe }))
vi.mock('@/hooks/useSettings', () => ({
  useUpdateProfile: h.useUpdateProfile,
  useChangePassword: h.useChangePassword,
  useSheetsStatus: h.useSheetsStatus,
  useSaveSheet: h.useSaveSheet,
  useTestSheet: h.useTestSheet,
}))

const idle = (over = {}) => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null, ...over })
const mutate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  h.useMe.mockReturnValue({ data: { id: 'u', email: 'pat@x.com', name: 'Pat', role: 'LANDLORD', locale: 'en' }, isPending: false, isError: false })
  h.useUpdateProfile.mockReturnValue(idle({ mutate }))
  h.useChangePassword.mockReturnValue(idle())
  h.useSaveSheet.mockReturnValue(idle())
  h.useTestSheet.mockReturnValue(idle())
  h.useSheetsStatus.mockReturnValue({ data: { configured: false, serviceAccountEmail: null, targetSpreadsheetId: null, reachable: false }, isPending: false })
})
afterEach(() => i18n.changeLanguage('en'))

describe('language switch', () => {
  it('switching to Chinese persists the locale and re-renders the app in Chinese (AE4)', async () => {
    render(<Settings />)
    expect(screen.getByText('Language')).toBeDefined() // section title in English first
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    expect(mutate).toHaveBeenCalledWith({ locale: 'zh' }) // persisted server-side
    await waitFor(() => {
      expect(i18n.language).toBe('zh')
      expect(screen.getByText('语言')).toBeDefined() // section re-rendered in Chinese
    })
  })

  it('reconciles the UI language to the server preference on load', async () => {
    h.useMe.mockReturnValue({ data: { id: 'u', email: 'p@x.com', name: 'P', role: 'LANDLORD', locale: 'zh' }, isPending: false, isError: false })
    expect(i18n.language).toBe('en')
    render(
      <MemoryRouter>
        <AuthGuard />
      </MemoryRouter>,
    )
    await waitFor(() => expect(i18n.language).toBe('zh'))
  })
})
