import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InvoiceList from '@/pages/InvoiceList'
import { generateInvoicesPdf } from '@/lib/invoicePdf'

// The PDF module is exercised by its own unit tests; here it's a boundary.
vi.mock('@/lib/invoicePdf', () => ({ generateInvoicesPdf: vi.fn() }))
const generatePdfMock = vi.mocked(generateInvoicesPdf)

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
  propertyId: 'prop-1',
}

function propertiesResponse() {
  return jsonRes(200, { data: [{ id: 'prop-1', name: 'Main', address: '12 Main St', notes: null }] })
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
  propertiesImpl: () => Promise<unknown> = () => Promise.resolve(propertiesResponse()),
) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/invoices/export')) return exportImpl()
    if (String(url).includes('/api/invoices/stats')) return Promise.resolve(statsResponse())
    if (String(url).includes('/api/properties')) return propertiesImpl()
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

  it('issues a description search query (debounced) when typing in the search box', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([row]))
    renderList(fetchMock)
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())

    fireEvent.change(screen.getByLabelText('Search by description'), { target: { value: 'faucet' } })
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('search=faucet'))).toBe(true),
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

const rowB = {
  ...row,
  id: 'b',
  invoiceNumber: 'INV-2',
  vendorName: 'Bolt Co',
  description: 'Paint hall',
  amount: '80.00',
}

/** Enter selection mode once the list has rendered. */
async function enterSelectionMode() {
  await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }))
  await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0))
}

describe('InvoiceList — PDF selection mode', () => {
  beforeEach(() => {
    generatePdfMock.mockReset()
    generatePdfMock.mockResolvedValue(undefined)
  })

  it('enters selection mode with checkboxes, counter, disabled Confirm at 0, and hint', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row, rowB])))
    await enterSelectionMode()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText('0 selected')).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm/i })).toHaveProperty('disabled', true)
    expect(screen.getByText(/selection mode/i)).toBeDefined()
  })

  it('Cancel exits, clears the selection, and returns focus to Generate PDF', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await enterSelectionMode()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    const generateBtn = screen.getByRole('button', { name: /generate pdf/i })
    await waitFor(() => expect(document.activeElement).toBe(generateBtn))
    // Re-entering shows a fresh, empty selection.
    fireEvent.click(generateBtn)
    await waitFor(() => expect(screen.getByText('0 selected')).toBeDefined())
  })

  it('Esc exits selection mode', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await enterSelectionMode()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryAllByRole('checkbox')).toHaveLength(0))
  })

  it('focuses the first checkbox on mode entry', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row, rowB])))
    await enterSelectionMode()
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('checkbox')[0]))
  })

  it('checking rows updates the counter and enables Confirm; unchecking reverts', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row, rowB])))
    await enterSelectionMode()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    expect(screen.getByText('2 selected')).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm/i })).toHaveProperty('disabled', false)
    fireEvent.click(boxes[1])
    expect(screen.getByText('1 selected')).toBeDefined()
  })

  it('row click toggles the checkbox; the invoice-number link keeps its href', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await enterSelectionMode()
    fireEvent.click(screen.getByText('Fix sink'))
    expect(screen.getByText('1 selected')).toBeDefined()
    expect(screen.getByText('INV-1').closest('a')?.getAttribute('href')).toBe('/invoices/a')
  })

  it('gives checkboxes accessible names with an em-dash fallback for null numbers', async () => {
    renderList(
      vi.fn().mockResolvedValue(listResponse([row, { ...rowB, invoiceNumber: null }])),
    )
    await enterSelectionMode()
    expect(screen.getByRole('checkbox', { name: 'Select invoice INV-1 — Acme' })).toBeDefined()
    expect(screen.getByRole('checkbox', { name: 'Select invoice — — Bolt Co' })).toBeDefined()
  })

  it('selection survives a page change and the counter keeps off-screen selections visible', async () => {
    const listMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('offset=20') ? listResponse([rowB], 40) : listResponse([row], 40),
      ),
    )
    renderList(listMock)
    await enterSelectionMode()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText('1 selected')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('INV-2')).toBeDefined())
    // Page 2's row is unchecked, but the page-1 selection still counts.
    expect(screen.getByText('1 selected')).toBeDefined()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('disables Export to Sheets during selection mode', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await enterSelectionMode()
    expect(screen.getByRole('button', { name: /export to sheets/i })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('disables Generate PDF while the Sheets export is in flight', async () => {
    let resolveExport: (v: unknown) => void = () => {}
    renderList(
      vi.fn().mockResolvedValue(listResponse([row])),
      '/',
      () =>
        new Promise((r) => {
          resolveExport = r
        }),
    )
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generate pdf/i })).toHaveProperty(
        'disabled',
        true,
      ),
    )
    resolveExport(jsonRes(200, { exported: 1 }))
  })

  it('entering selection mode clears a lingering Sheets success message', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', () =>
      Promise.resolve(jsonRes(200, { exported: 1 })),
    )
    await waitFor(() => expect(screen.getByText('INV-1')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /export to sheets/i }))
    await waitFor(() => expect(screen.getByText('Exported 1 invoice to Sheets.')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /generate pdf/i }))
    await waitFor(() => expect(screen.queryByText('Exported 1 invoice to Sheets.')).toBeNull())
  })
})

describe('InvoiceList — PDF confirm flow', () => {
  beforeEach(() => {
    generatePdfMock.mockReset()
    generatePdfMock.mockResolvedValue(undefined)
  })

  it('confirms: passes snapshotted rows + address map, exits mode, shows success', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row, rowB])))
    await enterSelectionMode()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(screen.getByText('PDF downloaded — 2 invoices.')).toBeDefined())
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    const [invoices, addresses] = generatePdfMock.mock.calls[0]
    expect(invoices.map((i) => i.id).sort()).toEqual(['a', 'b'])
    expect(addresses.get('prop-1')).toBe('12 Main St')
  })

  it('exports selections from a page that is no longer displayed', async () => {
    const listMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('offset=20') ? listResponse([rowB], 40) : listResponse([row], 40),
      ),
    )
    renderList(listMock)
    await enterSelectionMode()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(screen.getByText('INV-2')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByText('PDF downloaded — 1 invoice.')).toBeDefined())
    expect(generatePdfMock.mock.calls[0][0].map((i) => i.id)).toEqual(['a'])
  })

  it('keeps selection and shows an alert when the properties fetch fails', async () => {
    renderList(vi.fn().mockResolvedValue(listResponse([row])), '/', undefined, () =>
      Promise.reject(new Error('network down')),
    )
    await enterSelectionMode()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/pdf generation failed/i))
    // Selection mode and the checked row survive for a retry.
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(generatePdfMock).not.toHaveBeenCalled()
  })

  it('keeps selection and shows an alert when generation fails', async () => {
    generatePdfMock.mockRejectedValue(new Error('render exploded'))
    renderList(vi.fn().mockResolvedValue(listResponse([row])))
    await enterSelectionMode()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/pdf generation failed/i))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('is single-flight while generating: buttons disabled, Esc inert, snapshot fixed', async () => {
    let resolveGenerate: () => void = () => {}
    generatePdfMock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveGenerate = r
        }),
    )
    renderList(vi.fn().mockResolvedValue(listResponse([row, rowB])))
    await enterSelectionMode()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /generating/i })).toHaveProperty('disabled', true),
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
    fireEvent.keyDown(window, { key: 'Escape' })
    // Esc must not exit the mode or clear the selection mid-generation.
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByText('1 selected')).toBeDefined()

    resolveGenerate()
    await waitFor(() => expect(screen.getByText('PDF downloaded — 1 invoice.')).toBeDefined())
  })
})
