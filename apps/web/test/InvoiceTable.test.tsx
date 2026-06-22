import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { InvoiceTable } from '@/components/InvoiceTable'
import type { InvoiceListItem } from '@/hooks/useInvoices'

const rows: InvoiceListItem[] = [
  {
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
