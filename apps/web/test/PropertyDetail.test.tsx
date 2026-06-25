import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import PropertyDetail from '@/pages/PropertyDetail'

const { useProperty } = vi.hoisted(() => ({ useProperty: vi.fn() }))
const { useInvoices } = vi.hoisted(() => ({ useInvoices: vi.fn() }))
vi.mock('@/hooks/useProperties', () => ({ useProperty }))
vi.mock('@/hooks/useInvoices', () => ({ useInvoices }))

const property = (over = {}) => ({
  id: 'p1', name: 'Maple Duplex', address: '1 Maple Ave', notes: null, createdAt: '2026-06-01', totalSpend: '150.00', ...over,
})
const invoiceItem = {
  id: 'i1', invoiceNumber: 'INV-1', description: 'Roof repair', vendorName: 'Acme',
  invoiceDate: '2026-03-01', dueDate: null, amount: '100.00', status: 'PAID', sheetsSyncedAt: null,
}

function renderDetail() {
  return render(
    <MemoryRouter>
      <PropertyDetail />
    </MemoryRouter>,
  )
}

describe('PropertyDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the property header and total spend', () => {
    useProperty.mockReturnValue({ data: property(), isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [invoiceItem] }, isPending: false, isError: false })
    renderDetail()
    expect(screen.getByRole('heading', { name: 'Maple Duplex' })).toBeDefined()
    expect(screen.getByText('$150.00')).toBeDefined()
    expect(screen.getByText('Roof repair')).toBeDefined()
  })

  it('shows an empty state when the property has no invoices', () => {
    useProperty.mockReturnValue({ data: property(), isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderDetail()
    expect(screen.getByText(/no invoices assigned/i)).toBeDefined()
  })

  it('surfaces a not-found property cleanly', () => {
    useProperty.mockReturnValue({ data: undefined, isPending: false, isError: true })
    useInvoices.mockReturnValue({ data: undefined, isPending: false, isError: false })
    renderDetail()
    expect(screen.getByText(/property not found/i)).toBeDefined()
  })
})
