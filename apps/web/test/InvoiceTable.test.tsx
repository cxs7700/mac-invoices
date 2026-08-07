import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { InvoiceTable } from '@/components/InvoiceTable'
import type { InvoiceListItem } from '@/hooks/useInvoices'

const base = {
  updatedAt: '2026-01-20',
  sheetsSyncedAt: null,
  partsOrdered: null,
  imageCount: 1,
  vendorEmail: null,
  contractor: null,
}

const item = (description: string, sortOrder = 0) => ({
  id: `${description}-${sortOrder}`,
  description,
  quantity: 1,
  total: '100.00',
  sortOrder,
})

const rows: InvoiceListItem[] = [
  {
    ...base,
    id: 'a',
    invoiceNumber: 'INV-1',
    vendorName: 'Acme',
    items: [item('Fix sink')],
    amount: '100.00',
    category: 'REPAIRS',
    status: 'PENDING',
    invoiceDate: '2026-01-15',
    partsOrdered: '2x sink washer',
  },
  {
    ...base,
    id: 'b',
    invoiceNumber: 'INV-2',
    vendorName: 'Best',
    items: [item('Rewire')],
    amount: '200.00',
    category: 'REPAIRS',
    status: 'PAID',
    invoiceDate: '2026-01-20',
  },
]

describe('InvoiceTable', () => {
  it('renders a row per invoice with its number and vendor', () => {
    render(
      <MemoryRouter>
        <InvoiceTable invoices={rows} />
      </MemoryRouter>,
    )
    const r1 = screen.getByText('INV-1').closest('tr')!
    expect(within(r1).getByText('Acme')).toBeDefined()
    expect(screen.getByText('INV-2')).toBeDefined()
  })

  it('shows partsOrdered when present and an em dash when null', () => {
    render(
      <MemoryRouter>
        <InvoiceTable invoices={rows} />
      </MemoryRouter>,
    )
    const r1 = screen.getByText('INV-1').closest('tr')!
    expect(within(r1).getByText('2x sink washer')).toBeDefined()
    const r2 = screen.getByText('INV-2').closest('tr')!
    expect(within(r2).getByText('—')).toBeDefined()
  })

  it('renders a joined summary of item descriptions', () => {
    const multi: InvoiceListItem = {
      ...base,
      id: 'c',
      invoiceNumber: 'INV-3',
      vendorName: 'Multi',
      items: [item('Drywall', 0), item('Paint', 1)],
      amount: '300.00',
      category: 'REPAIRS',
      status: 'PENDING',
      invoiceDate: '2026-01-25',
    }
    render(
      <MemoryRouter>
        <InvoiceTable invoices={[multi]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Drywall, Paint')).toBeDefined()
  })
})

describe('InvoiceTable add-photo indicator (AE3)', () => {
  const make = (over: Partial<InvoiceListItem>): InvoiceListItem => ({
    ...base,
    id: 'x',
    invoiceNumber: 'INV-9',
    vendorName: 'V',
    items: [item('D')],
    amount: '10.00',
    category: 'OTHER',
    status: 'PAID',
    invoiceDate: '2026-01-15',
    imageCount: 0,
    ...over,
  })

  const renderRows = (invoices: InvoiceListItem[]) =>
    render(
      <MemoryRouter>
        <InvoiceTable invoices={invoices} />
      </MemoryRouter>,
    )

  it('shows an actionable indicator for an active invoice with no photos', () => {
    renderRows([make({ id: 'paid0', status: 'PAID', imageCount: 0 })])
    const link = screen.getByRole('link', { name: /add a photo to this invoice/i })
    expect(link.getAttribute('href')).toBe('/invoices/paid0')
  })

  it('hides the indicator for a terminal (CANCELLED) invoice with no photos', () => {
    renderRows([make({ id: 'canc', status: 'CANCELLED', imageCount: 0 })])
    expect(screen.queryByRole('link', { name: /add a photo/i })).toBeNull()
  })

  it('hides the indicator for an invoice that already has a photo', () => {
    renderRows([make({ id: 'has', status: 'PAID', imageCount: 2 })])
    expect(screen.queryByRole('link', { name: /add a photo/i })).toBeNull()
  })
})
