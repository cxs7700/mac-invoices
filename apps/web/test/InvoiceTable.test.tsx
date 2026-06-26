import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { InvoiceTable } from '@/components/InvoiceTable'
import type { InvoiceListItem } from '@/hooks/useInvoices'

const base = {
  updatedAt: '2026-01-20',
  sheetsSyncedAt: null,
  imageCount: 1,
}

const rows: InvoiceListItem[] = [
  {
    ...base,
    id: 'a',
    invoiceNumber: 'INV-1',
    vendorName: 'Acme',
    description: 'Fix sink',
    amount: '100.00',
    category: 'REPAIRS',
    status: 'PENDING',
    invoiceDate: '2026-01-15',
    dueDate: '2026-02-15',
  },
  {
    ...base,
    id: 'b',
    invoiceNumber: 'INV-2',
    vendorName: 'Best',
    description: 'Rewire',
    amount: '200.00',
    category: 'REPAIRS',
    status: 'PAID',
    invoiceDate: '2026-01-20',
    dueDate: null,
  },
]

describe('InvoiceTable due-date column', () => {
  it('renders the due date when present and an em dash when null', () => {
    render(
      <MemoryRouter>
        <InvoiceTable invoices={rows} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Due')).toBeDefined()

    const r1 = screen.getByText('INV-1').closest('tr')!
    expect(within(r1).getByText('Feb 15, 2026')).toBeDefined()

    const r2 = screen.getByText('INV-2').closest('tr')!
    expect(within(r2).getByText('—')).toBeDefined()
  })
})

describe('InvoiceTable add-photo indicator (AE3)', () => {
  const make = (over: Partial<InvoiceListItem>): InvoiceListItem => ({
    ...base,
    id: 'x',
    invoiceNumber: 'INV-9',
    vendorName: 'V',
    description: 'D',
    amount: '10.00',
    category: 'OTHER',
    status: 'PAID',
    invoiceDate: '2026-01-15',
    dueDate: null,
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
