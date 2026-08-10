import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InvoiceEdit from '@/pages/InvoiceEdit'

const invoice = {
  id: 'a',
  invoiceNumber: 'INV-1',
  vendorName: 'Acme',
  vendorEmail: null,
  vendorId: 'v1',
  items: [{ id: 'i1', description: 'Fix sink', quantity: 1, total: '149.99', sortOrder: 0 }],
  amount: '149.99',
  currency: 'USD',
  category: 'REPAIRS',
  propertyId: 'p1',
  status: 'PENDING',
  invoiceDate: '2026-01-15',
  paidDate: null,
  notes: 'left key under mat',
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

function setup() {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
    if ((init?.method ?? 'GET') === 'PATCH') return Promise.resolve(json(200, invoice))
    return Promise.resolve(json(200, invoice))
  })
  vi.stubGlobal('fetch', fetchMock)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/invoices/a/edit']}>
        <Routes>
          <Route path="/invoices/:id" element={<div>DETAIL</div>} />
          <Route path="/invoices/:id/edit" element={<InvoiceEdit />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('InvoiceEdit', () => {
  it('prefills the form from the fetched invoice', async () => {
    setup()
    await waitFor(() =>
      expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Acme'),
    )
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Fix sink')
    expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe('149.99')
    // The number is system-assigned: no editable field, but it stays visible in
    // the heading.
    expect(screen.queryByLabelText('Invoice number')).toBeNull()
    expect(screen.getByText(/Edit invoice INV-1/)).toBeDefined()
  })

  it('saves edits via PATCH and navigates to the detail page', async () => {
    const fetchMock = setup()
    await waitFor(() =>
      expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Acme'),
    )

    fireEvent.change(screen.getByLabelText('Total'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[1]?.method === 'PATCH' && String(c[1]?.body).includes('200'),
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.getByText('DETAIL')).toBeDefined())
  })

  it('round-trips a pre-existing vendorId on save when the vendor name is untouched', async () => {
    const fetchMock = setup()
    await waitFor(() =>
      expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Acme'),
    )

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => c[1]?.method === 'PATCH' && String(c[1]?.body).includes('"vendorId":"v1"'),
        ),
      ).toBe(true),
    )
  })

  it('clears the pre-existing vendorId on save when the vendor name is edited', async () => {
    const fetchMock = setup()
    await waitFor(() =>
      expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Acme'),
    )

    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Acme Annex' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true),
    )
    const patchCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')
    const body = JSON.parse(String(patchCall?.[1]?.body))
    expect(body.vendorId).toBeUndefined()
    expect(body.vendorName).toBe('Acme Annex')
  })
})
