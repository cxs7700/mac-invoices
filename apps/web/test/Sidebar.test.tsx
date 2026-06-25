import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Sidebar } from '@/components/Sidebar'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Sidebar', () => {
  it('shows the active Invoices link and disabled "Soon" items, and logs out', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/auth/logout')) return Promise.resolve(jsonResponse(204, ''))
      return Promise.resolve(jsonResponse(200, { id: 'u', email: 'a@b.com', name: 'Landlord', role: 'LANDLORD' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/invoices']}>
          <Sidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('link', { name: 'Invoices' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeDefined() // now a real route
    expect(screen.getByRole('link', { name: 'Contractors' })).toBeDefined() // now a real route
    expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined() // now a real route
    expect(screen.getByText('Properties').getAttribute('aria-disabled')).toBe('true') // still a Soon stub

    fireEvent.click(screen.getByRole('button', { name: /log out/i }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/auth/logout'))).toBe(true),
    )
  })
})
