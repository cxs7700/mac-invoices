import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  fill('Property', 'p1')
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
    fill('Property', 'p1')
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

    // Validation blocks the submit; the resolver never hands values through.
    await new Promise((r) => setTimeout(r, 0))
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

  it('refuses to submit without a property', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)
    fill('Vendor', 'Acme')
    fill('Description', 'Work')
    fill('Total', '100')
    fill('Invoice date', '2026-01-15')
    // Property deliberately left unselected — it is required on both forms.
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('adds and removes item rows, and updates the computed total live', async () => {
    render(<InvoiceForm onSubmit={vi.fn()} />)
    expect(screen.getAllByLabelText('Description')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /add line/i }))
    expect(screen.getAllByLabelText('Description')).toHaveLength(2)

    const totals = screen.getAllByLabelText('Total')
    fireEvent.change(totals[0], { target: { value: '30' } })
    fireEvent.change(totals[1], { target: { value: '20' } })
    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === 'Invoice total: $50.00'),
      ).toBeDefined(),
    )

    const removeButtons = screen.getAllByRole('button', { name: /^Remove line/i })
    fireEvent.click(removeButtons[0])
    expect(screen.getAllByLabelText('Description')).toHaveLength(1)
  })

  it('submits multiple items in order', async () => {
    const onSubmit = vi.fn()
    render(<InvoiceForm onSubmit={onSubmit} />)
    fill('Vendor', 'Acme')
    fill('Description', 'Drywall')
    fill('Total', '200')
    fireEvent.click(screen.getByRole('button', { name: /add line/i }))
    const descriptions = screen.getAllByLabelText('Description')
    fireEvent.change(descriptions[1], { target: { value: 'Paint' } })
    const totals = screen.getAllByLabelText('Total')
    fireEvent.change(totals[1], { target: { value: '50' } })
    fill('Invoice date', '2026-01-15')
    fill('Property', 'p1')
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].items).toEqual([
      { description: 'Drywall', quantity: 1, total: 200 },
      { description: 'Paint', quantity: 1, total: 50 },
    ])
  })

  describe('vendor picker', () => {
    /**
     * Scoped to the popup: the category and property <select>s also contain
     * role="option" elements, so an unscoped query would count those too.
     */
    function vendorOptionNames() {
      const list = screen.queryByRole('listbox')
      return list === null
        ? null
        : within(list)
            .queryAllByRole('option')
            .map((o) => o.textContent)
    }
    const vendorInput = () => screen.getByLabelText('Vendor') as HTMLInputElement

    it('opens a dropdown of every saved vendor on click, before anything is typed', () => {
      renderInvoiceForm({
        vendors: [
          { id: 'v1', name: 'Ace Plumbing' },
          { id: 'v2', name: 'Best Electric' },
        ],
      })

      // Closed until asked for — no stray listbox in the initial render.
      expect(vendorOptionNames()).toBeNull()

      fireEvent.click(vendorInput())

      expect(vendorOptionNames()).toEqual(['Ace Plumbing', 'Best Electric'])
    })

    it('sets vendorName and vendorId when an option is clicked', async () => {
      renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

      fireEvent.click(vendorInput())
      fireEvent.click(within(screen.getByRole('listbox')).getByText('Ace Plumbing'))

      // The list closes and the pick lands in the field itself.
      expect(vendorOptionNames()).toBeNull()
      expect(vendorInput().value).toBe('Ace Plumbing')

      await submitForm()
      expect(submitted()).toMatchObject({ vendorName: 'Ace Plumbing', vendorId: 'v1' })
    })

    it('filters the dropdown as the user types', () => {
      renderInvoiceForm({
        vendors: [
          { id: 'v1', name: 'Ace Plumbing' },
          { id: 'v2', name: 'Best Electric' },
        ],
      })

      fill('Vendor', 'elec')

      expect(vendorOptionNames()).toEqual(['Best Electric'])
    })

    it('reopens with the full list after a pick, not just the matched row', () => {
      renderInvoiceForm({
        vendors: [
          { id: 'v1', name: 'Ace Plumbing' },
          { id: 'v2', name: 'Best Electric' },
        ],
      })

      fireEvent.click(vendorInput())
      fireEvent.click(within(screen.getByRole('listbox')).getByText('Ace Plumbing'))
      fireEvent.click(vendorInput())

      expect(vendorOptionNames()).toEqual(['Ace Plumbing', 'Best Electric'])
    })

    it('picks the highlighted option with the keyboard', async () => {
      renderInvoiceForm({
        vendors: [
          { id: 'v1', name: 'Ace Plumbing' },
          { id: 'v2', name: 'Best Electric' },
        ],
      })

      const input = vendorInput()
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // opens, highlights first
      fireEvent.keyDown(input, { key: 'ArrowDown' }) // moves to second
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(input.value).toBe('Best Electric')
      await submitForm()
      expect(submitted()).toMatchObject({ vendorName: 'Best Electric', vendorId: 'v2' })
    })

    it('closes on Escape without clearing what was typed', () => {
      renderInvoiceForm({ vendors: [{ id: 'v1', name: 'Ace Plumbing' }] })

      const input = vendorInput()
      fill('Vendor', 'Ace')
      expect(vendorOptionNames()).toEqual(['Ace Plumbing'])

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(vendorOptionNames()).toBeNull()
      expect(input.value).toBe('Ace')
    })

    it('tells the user how to proceed when there are no saved vendors', () => {
      renderInvoiceForm({ vendors: [] })

      fireEvent.click(vendorInput())

      expect(vendorOptionNames()).toEqual([])
      expect(screen.getByText(/no saved vendors yet/i)).not.toBeNull()
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
