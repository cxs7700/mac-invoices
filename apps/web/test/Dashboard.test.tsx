import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Dashboard from '@/pages/Dashboard'

const { useInvoiceSummary, useInvoices } = vi.hoisted(() => ({
  useInvoiceSummary: vi.fn(),
  useInvoices: vi.fn(),
}))
vi.mock('@/hooks/useInvoiceSummary', () => ({ useInvoiceSummary }))
vi.mock('@/hooks/useInvoices', () => ({ useInvoices }))

const summary = {
  total: { count: 3, amount: '350.00' },
  byCategory: [
    { category: 'REPAIRS', count: 2, amount: '150.00' },
    { category: 'UTILITIES', count: 1, amount: '200.00' },
    { category: 'LABOR', count: 0, amount: '0.00' },
  ],
  byStatus: [
    { status: 'PENDING', count: 3, amount: '350.00' },
    { status: 'PAID', count: 0, amount: '0.00' },
  ],
}

const recentInvoice = {
  id: 'i1',
  invoiceNumber: 'INV-1',
  vendorName: 'Acme',
  vendorEmail: null,
  items: [{ id: 'i1-1', description: 'fix', quantity: 1, total: '150.00', sortOrder: 0 }],
  amount: '150.00',
  category: 'REPAIRS',
  status: 'PENDING',
  invoiceDate: '2026-02-01',
  updatedAt: '2026-02-01',
  sheetsSyncedAt: null,
  contractor: null,
}

const renderDash = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )

describe('Dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows totals, a category bar, and recent invoices', () => {
    useInvoiceSummary.mockReturnValue({ data: summary, isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [recentInvoice] } })
    renderDash()
    expect(screen.getByText('Total spend')).toBeDefined()
    expect(screen.getByText('Outstanding')).toBeDefined()
    expect(screen.getAllByText('$350.00').length).toBeGreaterThan(0)
    expect(screen.getByText('Repairs')).toBeDefined() // category bar label, title-cased
    expect(screen.getByText('INV-1')).toBeDefined() // recent invoice row
  })

  it('shows an empty state when there are no invoices', () => {
    useInvoiceSummary.mockReturnValue({
      data: { total: { count: 0, amount: '0.00' }, byCategory: [], byStatus: [] },
      isPending: false,
      isError: false,
    })
    useInvoices.mockReturnValue({ data: undefined })
    renderDash()
    expect(screen.getByText(/No invoices yet/i)).toBeDefined()
  })
})
