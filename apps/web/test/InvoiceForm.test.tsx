import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InvoiceForm } from '@/components/InvoiceForm'

vi.mock('@/hooks/useProperties', () => ({
  useProperties: () => ({
    data: {
      data: [{ id: 'p1', name: 'Maple', address: 'A', notes: null, createdAt: '2026-06-01' }],
    },
    isPending: false,
    isError: false,
  }),
}))

// Mutable list read by the mocked useVendors below — set per-test via
// renderInvoiceForm's `vendors` option, avoiding a real QueryClientProvider.
const { getMockVendors, setMockVendors } = vi.hoisted(() => {
  let vendors: { id: string; name: string }[] = []
  return {
    getMockVendors: () => vendors,
    setMockVendors: (v: { id: string; name: string }[]) => {
      vendors = v
    },
  }
})
vi.mock('@/hooks/useVendors', () => ({
  useVendors: () => ({ data: { data: getMockVendors() } }),
}))

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

type FormDefaults = { vendorName?: string; vendorId?: string }

let lastOnSubmit: ReturnType<typeof vi.fn>

/** Renders InvoiceForm with a controllable vendor list and captures submits. */
function renderInvoiceForm(
  opts: { vendors?: { id: string; name: string }[]; defaultValues?: FormDefaults } = {},
) {
  setMockVendors(opts.vendors ?? [])
  lastOnSubmit = vi.fn()
  render(<InvoiceForm onSubmit={lastOnSubmit} defaultValues={opts.defaultValues} />)
}

/** Fills the remaining required fields and submits. */
async function submitForm() {
  fill('Description', 'Work')
  fill('Total', '100')
  fill('Invoice date', '2026-01-15')
  fireEvent.click(screen.getByRole('button', { name: /create invoice|save changes/i }))
  await waitFor(() => expect(lastOnSubmit).toHaveBeenCalledTimes(1))
}

function submitted() {
  return lastOnSubmit.mock.calls[0][0]
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
      expect(
        screen.getByText((_, el) => el?.textContent === 'Invoice total: $50.00'),
      ).toBeDefined(),
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

  describe('vendor picker', () => {
    it('suggests saved vendors and sets vendorId when one is picked', async () => {
      renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

      // The datalist offers the saved vendor as a suggestion.
      const option = document.querySelector('#vendor-options option[value="Ace Plumbing"]')
      expect(option).not.toBeNull()

      // Picking a datalist option sets the input's value and fires a change
      // event, exactly like typing — simulate that directly.
      fill('Vendor', 'Ace Plumbing')

      await submitForm()
      expect(submitted()).toMatchObject({ vendorName: 'Ace Plumbing', vendorId: 'v1' })
    })

    it('allows a name that matches no saved vendor and sends no vendorId', async () => {
      renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

      fill('Vendor', 'Brand New Vendor')
      await submitForm()

      expect(submitted()).toMatchObject({ vendorName: 'Brand New Vendor' })
      expect(submitted().vendorId).toBeUndefined()
    })

    it('clears a previously picked vendorId when the name is edited', async () => {
      renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

      fill('Vendor', 'Ace Plumbing')
      fill('Vendor', 'Ace Plumbing Annex')

      await submitForm()
      expect(submitted().vendorId).toBeUndefined()
    })

    it('keeps a pre-existing vendorId from defaultValues when the name is untouched', async () => {
      renderInvoiceForm({
        vendors: [{ id: 'v1', name: 'Ace Plumbing' }],
        defaultValues: { vendorName: 'Ace Plumbing', vendorId: 'v1' },
      })

      await submitForm()
      expect(submitted()).toMatchObject({ vendorName: 'Ace Plumbing', vendorId: 'v1' })
    })

    it('clears a pre-existing vendorId from defaultValues when the name is edited', async () => {
      renderInvoiceForm({
        vendors: [{ id: 'v1', name: 'Ace Plumbing' }],
        defaultValues: { vendorName: 'Ace Plumbing', vendorId: 'v1' },
      })

      fill('Vendor', 'Ace Plumbing Annex')

      await submitForm()
      expect(submitted().vendorId).toBeUndefined()
    })
  })
})
