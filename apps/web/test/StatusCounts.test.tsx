import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusCounts } from '@/components/StatusCounts'

function statsOk() {
  const body = { counts: { PENDING: 4, APPROVED: 0, PAID: 2, REJECTED: 1, CANCELLED: 0 }, total: 7 }
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function renderStrip(activeStatus: string, onSelect = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statsOk()))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <StatusCounts activeStatus={activeStatus} onSelect={onSelect} />
    </QueryClientProvider>,
  )
  return onSelect
}

afterEach(() => vi.unstubAllGlobals())

describe('StatusCounts', () => {
  it('renders a chip per status with counts and a total', async () => {
    renderStrip('')
    await waitFor(() => expect(screen.getByText('7 total')).toBeDefined())
    expect(screen.getByRole('button', { name: /filter by pending, 4 invoices/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /filter by paid, 2 invoices/i })).toBeDefined()
  })

  it('selects a status on click and clears it when the active chip is re-clicked', async () => {
    const onSelect = renderStrip('PAID')
    await waitFor(() => expect(screen.getByText('7 total')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /filter by pending/i }))
    expect(onSelect).toHaveBeenCalledWith('PENDING')

    fireEvent.click(screen.getByRole('button', { name: /filter by paid/i }))
    expect(onSelect).toHaveBeenCalledWith('')
  })

  it('marks the active chip with aria-pressed', async () => {
    renderStrip('PAID')
    await waitFor(() => expect(screen.getByText('7 total')).toBeDefined())
    const paid = screen.getByRole('button', { name: /filter by paid/i })
    expect(paid.getAttribute('aria-pressed')).toBe('true')
    const pending = screen.getByRole('button', { name: /filter by pending/i })
    expect(pending.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders nothing when the stats fetch fails (no blank gap)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <StatusCounts activeStatus="" onSelect={vi.fn()} />
      </QueryClientProvider>,
    )
    // Loading shows aria-busy skeletons; on error the strip collapses to null.
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull())
    expect(screen.queryByRole('button')).toBeNull()
  })
})
