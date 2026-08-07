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
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(screen.getByLabelText('Invite code')).toBeTruthy()
    expect(screen.getByLabelText('First name')).toBeTruthy()
    expect(screen.getByLabelText('Last name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
  })

  it('swaps back to login', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.queryByLabelText('Invite code')).toBeNull()
  })

  it('submits the full signup payload', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
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

  it('blocks submission and reports a too-short password', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(signupMutate).not.toHaveBeenCalled()
  })
})
