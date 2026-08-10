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
  useDisconnectSheet: vi.fn(),
}))
vi.mock('@/hooks/useAuth', () => ({ useMe: h.useMe }))
vi.mock('@/hooks/useSettings', () => ({
  useUpdateProfile: h.useUpdateProfile,
  useChangePassword: h.useChangePassword,
  useSheetsStatus: h.useSheetsStatus,
  useSaveSheet: h.useSaveSheet,
  useTestSheet: h.useTestSheet,
  useDisconnectSheet: h.useDisconnectSheet,
}))

const idle = (over = {}) => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  error: null,
  ...over,
})

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.useMe.mockReturnValue({
      data: {
        id: 'u',
        email: 'pat@x.com',
        name: 'Pat Doe',
        firstName: 'Pat',
        lastName: 'Doe',
        role: 'LANDLORD',
      },
    })
    h.useUpdateProfile.mockReturnValue(idle())
    h.useChangePassword.mockReturnValue(idle())
    h.useSaveSheet.mockReturnValue(idle())
    h.useTestSheet.mockReturnValue(idle())
    h.useDisconnectSheet.mockReturnValue(idle())
    h.useSheetsStatus.mockReturnValue({
      data: {
        configured: true,
        serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
        targetSpreadsheetId: 'SID',
        reachable: true,
      },
      isPending: false,
    })
  })

  it('renders first name, last name, and an editable email', () => {
    render(<Settings />)
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Pat')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Doe')
    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect(email.value).toBe('pat@x.com')
    expect(email.readOnly).toBe(false)
  })

  it('saves the profile name and email', () => {
    const mutate = vi.fn()
    h.useUpdateProfile.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Patricia' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'patricia@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mutate).toHaveBeenCalledWith({
      firstName: 'Patricia',
      lastName: 'Doe',
      email: 'patricia@x.com',
    })
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
    h.useChangePassword.mockReturnValue(
      idle({ error: new ApiError('UNAUTHORIZED', 'Current password is incorrect', 401) }),
    )
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
    h.useTestSheet.mockReturnValue(
      idle({
        error: new ApiError(
          'SHEET_PERMISSION_DENIED',
          'share it as Editor with the service-account email',
          502,
        ),
      }),
    )
    render(<Settings />)
    expect(screen.getByText(/share it as Editor/)).toBeDefined()
  })

  it('does not let the browser prefill the current-password field', () => {
    render(<Settings />)
    // "current-password" here would be exactly the value that causes the
    // prefill — with it, the re-auth gating a password change is satisfied by
    // the browser rather than by the person at the keyboard.
    //
    // jsdom has no autofill, so this asserts the signal the app sends, not
    // the browser's actual response to it. Green here is not proof autofill
    // behaves as intended.
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
  })

  it('tells landlords the Sheets field accepts a URL as well as an id', async () => {
    render(<Settings />)
    // Pasting the share URL is the natural action; the label should not imply
    // only a bare id works.
    expect(await screen.findByLabelText('Target spreadsheet ID or URL')).toBeTruthy()
  })

  it('shows the normalized bare id (not the pasted URL) after a successful save', () => {
    // Mimic the real hook: a successful save writes the server's normalized
    // status into the query cache (reflected here by updating what
    // useSheetsStatus returns) and then fires onSuccess.
    const mutate = vi.fn((_payload: unknown, opts?: { onSuccess?: () => void }) => {
      h.useSheetsStatus.mockReturnValue({
        data: {
          configured: true,
          serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
          targetSpreadsheetId: 'BareIdFromServer0000000000000000000000000',
          reachable: true,
        },
        isPending: false,
      })
      opts?.onSuccess?.()
    })
    h.useSaveSheet.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    const input = screen.getByLabelText('Target spreadsheet ID or URL') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        value:
          'https://docs.google.com/spreadsheets/d/BareIdFromServer0000000000000000000000000/edit',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }))
    // The local override is cleared on success, so the field now falls back
    // to the fresh cached status rather than the pasted URL still in state.
    expect(input.value).toBe('BareIdFromServer0000000000000000000000000')
  })

  it('offers no disconnect control when no sheet is connected (AE8)', () => {
    h.useSheetsStatus.mockReturnValue({
      data: {
        configured: true,
        serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
        targetSpreadsheetId: null,
        reachable: false,
      },
      isPending: false,
    })
    render(<Settings />)
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('disconnects the connected sheet and drops any unsaved draft from the field', () => {
    // The reset only does anything when a local override exists — with no
    // draft, the field already follows the status. So type first: that is the
    // case where dropping the override is what stops the input contradicting
    // the server. Same mock shape as the existing save test: update what
    // useSheetsStatus returns, then fire onSuccess.
    const mutate = vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => {
      h.useSheetsStatus.mockReturnValue({
        data: {
          configured: true,
          serviceAccountEmail: 'svc@project.iam.gserviceaccount.com',
          targetSpreadsheetId: null,
          reachable: false,
        },
        isPending: false,
      })
      opts?.onSuccess?.()
    })
    h.useDisconnectSheet.mockReturnValue(idle({ mutate }))
    render(<Settings />)
    const input = screen.getByLabelText('Target spreadsheet ID or URL') as HTMLInputElement
    expect(input.value).toBe('SID') // the connected id from beforeEach
    fireEvent.change(input, { target: { value: 'a-draft-the-landlord-abandoned' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(mutate).toHaveBeenCalled()
    // Override dropped, so the field falls back to the refreshed status — empty
    // — rather than still showing the abandoned draft.
    expect(input.value).toBe('')
  })

  it('will not let an emptied field clear the connection (AE7)', () => {
    render(<Settings />)
    const input = screen.getByLabelText('Target spreadsheet ID or URL') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    // Save stays disabled on empty — clearing the field is not a disconnect.
    expect(
      (screen.getByRole('button', { name: 'Save target' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
