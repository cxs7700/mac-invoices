import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvoiceTimeline } from '@/components/InvoiceTimeline'
import type { Invoice } from '@/hooks/useInvoice'

const base: Invoice = {
  id: 'a',
  invoiceNumber: 'INV-1',
  vendorName: 'Acme',
  vendorEmail: null,
  description: 'Fix sink',
  amount: '100.00',
  currency: 'USD',
  category: 'REPAIRS',
  propertyId: null,
  status: 'PENDING',
  invoiceDate: '2026-01-15',
  dueDate: null,
  paidDate: null,
  notes: null,
  attachmentUrl: null,
  createdAt: '2026-01-10',
  updatedAt: '2026-01-10',
}

function renderTimeline(overrides: Partial<Invoice>) {
  return render(<InvoiceTimeline invoice={{ ...base, ...overrides }} />)
}

describe('InvoiceTimeline', () => {
  it('PENDING without a due date → Created + Awaiting payment', () => {
    renderTimeline({ status: 'PENDING' })
    expect(screen.getByText('Created')).toBeDefined()
    expect(screen.getByText('Awaiting payment')).toBeDefined()
    expect(screen.queryByText('Overdue')).toBeNull()
  })

  it('PAID → Created + Paid', () => {
    renderTimeline({ status: 'PAID', paidDate: '2026-02-01' })
    expect(screen.getByText('Paid')).toBeDefined()
    expect(screen.queryByText('Awaiting payment')).toBeNull()
  })

  it('REJECTED → Created + Rejected (terminal)', () => {
    renderTimeline({ status: 'REJECTED' })
    expect(screen.getByText('Rejected')).toBeDefined()
  })

  it('CANCELLED → Created + Cancelled (terminal)', () => {
    renderTimeline({ status: 'CANCELLED' })
    expect(screen.getByText('Cancelled')).toBeDefined()
  })

  it('PENDING past its due date → inserts an Overdue node', () => {
    renderTimeline({ status: 'PENDING', dueDate: '2020-01-01' })
    expect(screen.getByText('Created')).toBeDefined()
    expect(screen.getByText('Overdue')).toBeDefined()
    expect(screen.getByText('Awaiting payment')).toBeDefined()
  })
})
