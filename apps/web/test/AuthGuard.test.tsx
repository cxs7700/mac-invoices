import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard } from '@/components/AuthGuard'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function setup(meResponse: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(meResponse))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/" element={<AuthGuard />}>
            <Route index element={<div>APP HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('AuthGuard', () => {
  it('redirects to /login when the session check is 401', async () => {
    setup(jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeDefined())
  })

  it('renders the app when /auth/me resolves a user', async () => {
    setup(jsonResponse(200, { id: 'u', email: 'a@b.com', name: null, role: 'LANDLORD' }))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeDefined())
  })

  it('shows a retry state (not /login) on a transient 5xx error', async () => {
    setup(jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } }))
    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeDefined())
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined()
  })
})
