import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InvoiceForm } from '@/components/InvoiceForm'

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => ({
    data: { data: [{ id: 'p1', name: 'Maple', address: 'A', notes: null, createdAt: '2026-06-01' }] },
    isPending: false,
    isError: false,
  }),
}))

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('InvoiceForm', () => {
  it('submits parsed values when the form is valid', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)

    // No invoice-number field — the server auto-assigns it on create.
    expect(screen.queryByLabelText('Invoice number')).toBeNull()

    fill('Vendor', 'Acme Plumbing')
    fill('Description', 'Replaced a valve')
    fill('Total', '149.99')
    fill('Invoice date', '2026-01-15')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0]
    expect(values.invoiceNumber).toBeUndefined()
    expect(values.vendorName).toBe('Acme Plumbing')
    expect(values.items).toEqual([{ description: 'Replaced a valve', quantity: 1, total: 149.99 }])
    expect(values.currency).toBe('USD')
    expect(values.invoiceDate).toBeInstanceOf(Date)
  })

  it('shows validation errors and does not submit when invalid', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)

    // Empty required fields + a negative total.
    fill('Total', '-5')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    await waitFor(() => expect(document.querySelector('.text-destructive')).not.toBeNull())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders a server error when provided', () => {
    render(<InvoiceForm onSubmit={vi.fn()} serverError="Invoice with this number already exists" />)
    expect(screen.getByText(/already exists/i)).toBeDefined()
  })

  it('submits the chosen property', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)
    fill('Vendor', 'Acme')
    fill('Description', 'Work')
    fill('Total', '100')
    fill('Invoice date', '2026-01-15')
    fill('Property', 'p1')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].propertyId).toBe('p1')
  })

  it('omits propertyId when the property is left as None', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)
    fill('Vendor', 'Acme')
    fill('Description', 'Work')
    fill('Total', '100')
    fill('Invoice date', '2026-01-15')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].propertyId).toBeUndefined()
  })

  it('adds and removes item rows, and updates the computed total live', async () => {
    render(<InvoiceForm onSubmit={vi.fn()} />)
    expect(screen.getAllByLabelText('Description')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /add item/i }))
    expect(screen.getAllByLabelText('Description')).toHaveLength(2)

    const totals = screen.getAllByLabelText('Total')
    fireEvent.change(totals[0], { target: { value: '30' } })
    fireEvent.change(totals[1], { target: { value: '20' } })
    await waitFor(() =>
      expect(screen.getByText((_, el) => el?.textContent === 'Invoice total: $50.00')).toBeDefined(),
    )

    const removeButtons = screen.getAllByRole('button', { name: /^Remove$/i })
    fireEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText('Description')).toHaveLength(1)
  })

  it('submits multiple items in order', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)
    fill('Vendor', 'Acme')
    fill('Description', 'Drywall')
    fill('Total', '200')
    fireEvent.click(screen.getByRole('button', { name: /add item/i }))
    const descriptions = screen.getAllByLabelText('Description')
    fireEvent.change(descriptions[1], { target: { value: 'Paint' } })
    const totals = screen.getAllByLabelText('Total')
    fireEvent.change(totals[1], { target: { value: '50' } })
    fill('Invoice date', '2026-01-15')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].items).toEqual([
      { description: 'Drywall', quantity: 1, total: 200 },
      { description: 'Paint', quantity: 1, total: 50 },
    ])
  })
})
