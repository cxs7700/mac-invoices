import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ResetPassword from '@/pages/ResetPassword'

const resetMutate = vi.fn()
vi.mock('@/hooks/useAuth', () => ({
  useResetPassword: () => ({ mutate: resetMutate, isPending: false, error: null }),
}))

const withHash = (hash: string) => {
  window.location.hash = hash
}

beforeEach(() => {
  vi.clearAllMocks()
  withHash('#t=rst_abc.123.xyz')
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  )

describe('ResetPassword', () => {
  // The page is a sibling of /login, outside AuthGuard — a locked-out user has
  // no session, so requiring one would make it useless.
  it('renders for a visitor with no session (AE8)', () => {
    renderPage()
    expect(screen.getByLabelText('New password')).toBeTruthy()
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy()
  })

  it('submits the token from the URL fragment with the new password', async () => {
    renderPage()
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-good-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(resetMutate).toHaveBeenCalled())
    expect(resetMutate.mock.calls[0][0]).toEqual({
      token: 'rst_abc.123.xyz',
      newPassword: 'a-good-password',
    })
  })

  it('blocks submission when the two passwords differ (AE7)', async () => {
    renderPage()
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeTruthy())
    expect(resetMutate).not.toHaveBeenCalled()
  })

  it('tells a visitor arriving with no token that the link is unusable', () => {
    withHash('')
    renderPage()
    expect(screen.getByRole('alert').textContent).toMatch(/link/i)
    expect(screen.queryByRole('button', { name: 'Set new password' })).toBeNull()
  })

  // jsdom has no autofill; this asserts the signal the app sends, per DEC-031.
  it('marks both password fields so saved credentials are not offered', () => {
    renderPage()
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Confirm new password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
  })
})
