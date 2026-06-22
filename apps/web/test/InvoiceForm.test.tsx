import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InvoiceForm } from '@/components/InvoiceForm'

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('InvoiceForm', () => {
  it('submits parsed values when the form is valid', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)

    fill('Invoice number', 'INV-100')
    fill('Vendor', 'Acme Plumbing')
    fill('Description', 'Replaced a valve')
    fill('Amount', '149.99')
    fill('Invoice date', '2026-01-15')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0]
    expect(values.invoiceNumber).toBe('INV-100')
    expect(values.amount).toBe(149.99)
    expect(values.currency).toBe('USD')
    expect(values.invoiceDate).toBeInstanceOf(Date)
  })

  it('shows validation errors and does not submit when invalid', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)

    // Empty required fields + a negative amount.
    fill('Amount', '-5')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    await waitFor(() => expect(document.querySelector('.text-destructive')).not.toBeNull())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders a server error when provided', () => {
    render(<InvoiceForm onSubmit={vi.fn()} serverError="Invoice with this number already exists" />)
    expect(screen.getByText(/already exists/i)).toBeDefined()
  })
})
