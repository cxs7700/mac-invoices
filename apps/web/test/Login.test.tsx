import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Login from '@/pages/Login'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Login', () => {
  it('submits valid credentials to /api/auth/login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { id: 'u', email: 'a@b.com', name: null, role: 'LANDLORD' }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderLogin()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toContain('/api/auth/login')
  })

  it('shows client validation errors and does not call the API on invalid submit', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderLogin()

    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }))
    await waitFor(() => expect(document.querySelector('.text-destructive')).not.toBeNull())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 401 server error and stays on the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
        }),
      ),
    )
    renderLogin()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }))

    await waitFor(() => expect(screen.getByText(/invalid email or password/i)).toBeDefined())
  })
})
