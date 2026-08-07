import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Login from '@/pages/Login'
import i18n from '@/lib/i18n'

const signupMutate = vi.fn()
const loginMutate = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useLogin: () => ({ mutate: loginMutate, isPending: false, error: null }),
  useSignup: () => ({ mutate: signupMutate, isPending: false, error: null }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  i18n.changeLanguage('en')
})

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )

describe('auth card toggle', () => {
  it('shows the login form first, with no signup-only fields', () => {
    renderLogin()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByLabelText('Invite code')).toBeNull()
  })

  it('swaps to the signup form when the Sign up tab is clicked', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    expect(screen.getByLabelText('Invite code')).toBeTruthy()
    expect(screen.getByLabelText('First name')).toBeTruthy()
    expect(screen.getByLabelText('Last name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
  })

  it('swaps back to login', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to log in' }))
    expect(screen.queryByLabelText('Invite code')).toBeNull()
  })

  it('submits the full signup payload', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(signupMutate).toHaveBeenCalled())
    expect(signupMutate.mock.calls[0][0]).toEqual({
      inviteCode: 'the-code',
      email: 'ada@example.com',
      password: 'a-good-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('normalizes a mixed-case email before submitting (resolver transform reaches mutate)', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'Ada@Example.COM' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(signupMutate).toHaveBeenCalled())
    expect(signupMutate.mock.calls[0][0].email).toBe('ada@example.com')
  })

  it('blocks submission and reports a too-short password', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'short' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(signupMutate).not.toHaveBeenCalled()
  })

  it('renders a confirmation field on the signup form', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))
    expect(screen.getByLabelText('Confirm password')).toBeTruthy()
  })

  it('blocks submission when the two passwords differ', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-different-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeTruthy())
    expect(signupMutate).not.toHaveBeenCalled()
  })

  it('does not send confirmPassword to the API', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(signupMutate).toHaveBeenCalled())
    // The confirmation is a client-side concern; the server contract never sees it.
    expect(signupMutate.mock.calls[0][0]).not.toHaveProperty('confirmPassword')
  })

  it('tells the browser not to offer saved credentials on the signup password fields', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    // autocomplete="off" is ignored by browsers on password inputs; the value
    // that actually suppresses saved-credential fill is "new-password".
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Confirm password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
  })

  it('still allows ordinary address-book autofill for the signup email', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))
    // An email is a contact detail, not a credential — suppressing it would
    // remove a real convenience for no security gain.
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email')
  })

  it('leaves the login form free to offer saved credentials', () => {
    renderLogin()
    // Login is deliberately untouched: offering the saved credential there is
    // correct. Assert we did not "helpfully" suppress it.
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).not.toBe('new-password')
  })
})
