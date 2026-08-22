import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { rangeStart } from '@/lib/listParams'
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
  byMonth: [
    { month: '2025-12', count: 1, amount: '150.00' },
    { month: '2026-01', count: 0, amount: '0.00' },
    { month: '2026-02', count: 2, amount: '200.00' },
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
  vendor: null,
}

const renderDash = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
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
      data: { total: { count: 0, amount: '0.00' }, byCategory: [], byStatus: [], byMonth: [] },
      isPending: false,
      isError: false,
    })
    useInvoices.mockReturnValue({ data: undefined })
    renderDash()
    expect(screen.getByText(/No invoices yet/i)).toBeDefined()
  })

  it('renders the monthly trend, including a zero month', () => {
    useInvoiceSummary.mockReturnValue({ data: summary, isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [recentInvoice] } })
    renderDash()
    expect(screen.getByText('Spend over time')).toBeDefined()
    // One screen-reader sentence per bucket, zero-filled month included.
    expect(screen.getByText(/Dec 25: \$150\.00, 1/)).toBeDefined()
    expect(screen.getByText(/Jan 26: \$0\.00, 0/)).toBeDefined()
    expect(screen.getByText(/Feb 26: \$200\.00, 2/)).toBeDefined()
  })

  it('reads the lookback from the URL and narrows both queries to it', () => {
    useInvoiceSummary.mockReturnValue({ data: summary, isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [recentInvoice] } })
    renderDash('/?range=1m')

    const from = rangeStart('1m')
    expect(useInvoiceSummary).toHaveBeenCalledWith({ from, to: '' })
    expect(useInvoices).toHaveBeenCalledWith(expect.objectContaining({ from, to: '', limit: 5 }))
    // The active preset is reflected in the control.
    expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('writes the chosen lookback to the URL', () => {
    useInvoiceSummary.mockReturnValue({ data: summary, isPending: false, isError: false })
    useInvoices.mockReturnValue({ data: { data: [recentInvoice] } })
    renderDash()

    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true')
    expect(useInvoiceSummary).toHaveBeenLastCalledWith({ from: rangeStart('3m'), to: '' })
  })

  it('shows a period-specific empty state when the window holds no invoices', () => {
    useInvoiceSummary.mockReturnValue({
      data: { total: { count: 0, amount: '0.00' }, byCategory: [], byStatus: [], byMonth: [] },
      isPending: false,
      isError: false,
    })
    useInvoices.mockReturnValue({ data: undefined })
    renderDash('/?range=1w')
    expect(screen.getByText(/No invoices in this period/i)).toBeDefined()
  })
})
