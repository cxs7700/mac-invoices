import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InvoiceList from '@/pages/InvoiceList'

function listResponse(items: unknown[], total = items.length) {
  const body = { data: items, pagination: { total, limit: 20, offset: 0 } }
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const row = {
  id: 'a',
  invoiceNumber: 'INV-1',
  vendorName: 'Acme',
  description: 'Fix sink',
  amount: '149.99',
  category: 'REPAIRS',
  status: 'PENDING',
  invoiceDate: '2026-01-15',
  dueDate: null,
}

function renderList(fetchMock: ReturnType<typeof vi.fn>, entry = '/') {
  vi.stubGlobal('fetch', fetchMock)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <InvoiceList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('InvoiceList', () => {
  it('renders invoice rows with formatted amount + status', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    expect(screen.getByText('$149.99')).toBeDefined()
    expect(screen.getByText('Pending')).toBeDefined()
  })

  it('issues a status-filtered query when the filter changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([row]))
    renderList(fetchMock)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'PAID' } })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('status=PAID'))).toBe(true),
    )
  })

  it('converts URL page=2 to offset=20 in the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([row], 60))
    renderList(fetchMock, '/?page=2')
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('offset=20'))).toBe(true),
    )
  })

  it('sanitizes a garbage URL to defaults rather than erroring', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([row]))
    renderList(fetchMock, '/?sort=__bad__&from=xyz&status=NOPE')
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).not.toContain('__bad__')
    expect(url).not.toContain('status=NOPE')
    expect(url).not.toContain('from=xyz')
  })

  it("keeps the row's detail link reachable (status transitions live there)", async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    const link = screen.getByText('INV-1').closest('a')
    expect(link?.getAttribute('href')).toBe('/invoices/a')
  })

  it('shows the empty state when the account has no invoices', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([])))
    await waitFor(() => expect(screen.getByText('No invoices yet')).toBeDefined())
  })

  it('shows a filtered-empty state (not "no invoices yet") when a filter matches nothing', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([])), '/?status=PAID')
    await waitFor(() => expect(screen.getByText('No invoices match your filters')).toBeDefined())
    expect(screen.queryByText('No invoices yet')).toBeNull()
  })

  it('shows an error state with retry on query failure', async () => {
    renderList(vi.fn().mockRejectedValue(new Error('boom')))
    await waitFor(() => expect(screen.getByText(/failed to load invoices/i)).toBeDefined())
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined()
  })
})
