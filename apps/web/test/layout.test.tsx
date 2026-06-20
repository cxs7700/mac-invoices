import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@/App'

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('App layout health indicator', () => {
  it('shows "API: ok" when /api/health resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'ok' }),
        text: async () => '{"status":"ok"}',
      }),
    )
    renderApp()
    expect(screen.getByText('Mac Invoices')).toBeDefined()
    await waitFor(() => expect(screen.getByText(/API:\s*ok/)).toBeDefined())
  })

  it('shows "API: unreachable" when health fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    renderApp()
    await waitFor(() => expect(screen.getByText(/API:\s*unreachable/)).toBeDefined())
  })
})
