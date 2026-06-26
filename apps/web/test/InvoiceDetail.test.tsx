import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InvoiceDetail from '@/pages/InvoiceDetail'

const invoice = {
  id: 'a',
  invoiceNumber: 'INV-1',
  vendorName: 'Acme',
  vendorEmail: null,
  description: 'Fix sink',
  amount: '149.99',
  currency: 'USD',
  category: 'REPAIRS',
  propertyId: null,
  status: 'PENDING',
  invoiceDate: '2026-01-15',
  dueDate: null,
  paidDate: null,
  notes: 'left key under mat',
  imageCount: 0,
  createdAt: '2026-01-10',
  updatedAt: '2026-01-10',
}

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function setup(getStatus = 200) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    if (method === 'PATCH') return Promise.resolve(json(200, { ...invoice, status: 'PAID' }))
    if (method === 'DELETE')
      return Promise.resolve({ ok: true, status: 204, headers: { get: () => null }, text: async () => '' })
    return Promise.resolve(
      getStatus === 200 ? json(200, invoice) : json(404, { error: { code: 'NOT_FOUND', message: 'x' } }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/invoices/a']}>
        <Routes>
          <Route path="/invoices" element={<div>LIST</div>} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('InvoiceDetail', () => {
  it('renders the invoice record', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())
    expect(screen.getByText('$149.99')).toBeDefined()
    expect(screen.getByText('left key under mat')).toBeDefined()
  })

  it('marks paid via PATCH status: PAID', async () => {
    const fetchMock = setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /mark as paid/i }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[1]?.method === 'PATCH' && String(c[1]?.body).includes('PAID'),
        ),
      ).toBe(true),
    )
  })

  it('rejects only after a confirm step', async () => {
    const fetchMock = setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /dispute \/ reject/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm reject/i }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[1]?.method === 'PATCH' && String(c[1]?.body).includes('REJECTED'),
        ),
      ).toBe(true),
    )
  })

  it('disables the send-reminder action', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())
    expect(screen.getByRole('button', { name: /send reminder/i })).toHaveProperty('disabled', true)
  })

  it('shows a not-found state on 404', async () => {
    setup(404)
    await waitFor(() => expect(screen.getByText(/invoice not found/i)).toBeDefined())
  })

  it('shows the add-photo CTA for an active invoice with no photos (AE3)', async () => {
    setup() // fixture: PENDING, imageCount 0
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())
    const cta = screen.getByRole('link', { name: /add one to document this invoice/i })
    expect(cta.getAttribute('href')).toBe('/invoices/a')
  })

  it('deletes via the confirm modal, then navigates to the list', async () => {
    const fetchMock = setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    // Confirm modal appears, scoped to this invoice.
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('INV-1')

    // The modal's Delete button issues the DELETE and routes to the list.
    const confirmBtn = within(dialog).getByRole('button', { name: /^delete$/i })
    fireEvent.click(confirmBtn)

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true),
    )
    await waitFor(() => expect(screen.getByText('LIST')).toBeDefined())
  })

  it('dismisses the delete modal on cancel without calling DELETE', async () => {
    const fetchMock = setup()
    await waitFor(() => expect(screen.getByText('Invoice INV-1')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)
  })
})
