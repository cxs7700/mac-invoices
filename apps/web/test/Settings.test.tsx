import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Settings from '@/pages/Settings'
import { ApiError } from '@/lib/apiClient'

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

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.useMe.mockReturnValue({ data: { id: 'u', email: 'pat@x.com', name: 'Pat', role: 'LANDLORD' } })
    h.useUpdateProfile.mockReturnValue(idle())
    h.useChangePassword.mockReturnValue(idle())
    h.useSaveSheet.mockReturnValue(idle())
    h.useTestSheet.mockReturnValue(idle())
    h.useSheetsStatus.mockReturnValue({
      data: { configured: true, serviceAccountEmail: 'svc@project.iam.gserviceaccount.com', targetSpreadsheetId: 'SID', reachable: true },
      isPending: false,
    })
  })

  it('renders the name (editable) and a read-only email', () => {
    render(<Settings />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Pat')
    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email.value).toBe('pat@x.com')
    expect(email.readOnly).toBe(true)
  })

  it('saves the profile name', () => {
    const mutate = vi.fn()
    h.useUpdateProfile.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Patricia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutate).toHaveBeenCalledWith({ name: 'Patricia' })
  })

  it('change password is disabled until current + a >=8 char new password', () => {
    const mutate = vi.fn()
    h.useChangePassword.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    const btn = screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough1' } })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(mutate).toHaveBeenCalled()
  })

  it('shows the change-password error inline', () => {
    h.useChangePassword.mockReturnValue(idle({ error: new ApiError('UNAUTHORIZED', 'Current password is incorrect', 401) }))
    render(<Settings />)
    expect(screen.getByText('Current password is incorrect')).toBeDefined()
  })

  it('renders the Sheets status + service-account email and tests the connection', () => {
    const testMutate = vi.fn()
    h.useTestSheet.mockReturnValue(idle({ mutate: testMutate }))
    render(<Settings />)
    expect(screen.getByText('Connected')).toBeDefined()
    expect(screen.getByText('svc@project.iam.gserviceaccount.com')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(testMutate).toHaveBeenCalled()
  })

  it('surfaces a failed test-connection error (the share-as-Editor hint)', () => {
    h.useTestSheet.mockReturnValue(idle({ error: new ApiError('SHEET_PERMISSION_DENIED', 'share it as Editor with the service-account email', 502) }))
    render(<Settings />)
    expect(screen.getByText(/share it as Editor/)).toBeDefined()
  })
})
