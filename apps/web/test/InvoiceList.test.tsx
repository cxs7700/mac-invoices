import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

function statsResponse() {
  const body = { counts: { PENDING: 0, APPROVED: 0, PAID: 0, REJECTED: 0, CANCELLED: 0 }, total: 0 }
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

// The list mock only ever sees list calls; the status-counts strip's /stats and
// the export POST are served separately so assertions on call[0] stay deterministic.
function renderList(
  listMock: ReturnType<typeof vi.fn>,
  entry = '/',
  exportImpl: () => Promise<unknown> = () => Promise.resolve(jsonRes(200, { exported: 0 })),
) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/invoices/export')) return exportImpl()
    if (String(url).includes('/api/invoices/stats')) return Promise.resolve(statsResponse())
    return listMock(url, init)
  })
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
    // Scope to the row — "Pending" also appears as a status-counts chip label.
    const tr = screen.getByText('INV-1').closest('tr')!
    expect(within(tr).getByText('Pending')).toBeDefined()
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

  it('resets to page 1 (offset 0) when a filter changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([row], 100))
    renderList(fetchMock, '/?page=3')
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'PAID' } })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('status=PAID'))).toBe(true),
    )
    // The post-change query carries offset=0, not offset=40.
    const afterChange = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('status=PAID'))
    expect(afterChange.every((u) => u.includes('offset=0'))).toBe(true)
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

describe('InvoiceList — export to Sheets', () => {
  it('exports on click and shows the count', async () => {
    let resolveExport: (v: unknown) => void = () => {}
    const exportImpl = () =>
      new Promise((r) => {
        resolveExport = r
      })
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', exportImpl)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())

    const btn = screen.getByRole('button', { name: /export to sheets/i })
    fireEvent.click(btn)
    // Pending: button disabled + label change.
    await waitFor(() => expect(screen.getByRole('button', { name: /exporting/i })).toHaveProperty('disabled', true))

    resolveExport(jsonRes(200, { exported: 3 }))
    await waitFor(() => expect(screen.getByText(/exported 3 invoices to sheets/i)).toBeDefined())
  })

  it('shows a readable message when export is not configured (503)', async () => {
    const exportImpl = () =>
      Promise.resolve(jsonRes(503, { error: { code: 'EXPORT_NOT_CONFIGURED', message: 'x' } }))
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', exportImpl)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() => expect(screen.getByText(/isn.t configured/i)).toBeDefined())
  })

  it('surfaces the durable count on a 502 partial export', async () => {
    const exportImpl = () =>
      Promise.resolve(
        jsonRes(502, { error: { code: 'EXPORT_INTERRUPTED', message: 'boom', details: { exported: 2 } } }),
      )
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', exportImpl)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() => expect(screen.getByText(/partial export: 2 written/i)).toBeDefined())
  })

  it('shows the raw message for a generic ApiError, and a fallback for a non-ApiError', async () => {
    const exportImpl = () =>
      Promise.resolve(jsonRes(502, { error: { code: 'SHEET_ERROR', message: 'sheet exploded' } }))
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', exportImpl)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() => expect(screen.getByText('sheet exploded')).toBeDefined())
  })

  it('renders a singular success message for exactly one invoice', async () => {
    const exportImpl = () => Promise.resolve(jsonRes(200, { exported: 1 }))
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', exportImpl)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() => expect(screen.getByText('Exported 1 invoice to Sheets.')).toBeDefined())
  })
})
