import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import VendorSubmit from '@/pages/VendorSubmit'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/apiClient'

const {
  useSubmissionStatus,
  useSubmit,
  useWithdraw,
  useSubmissionProperties,
  uploadSubmissionPhoto,
} = vi.hoisted(() => ({
  useSubmissionStatus: vi.fn(),
  useSubmit: vi.fn(),
  useWithdraw: vi.fn(),
  useSubmissionProperties: vi.fn(),
  uploadSubmissionPhoto: vi.fn(),
}))
vi.mock('@/hooks/useSubmission', () => ({
  useSubmissionStatus,
  useSubmit,
  useWithdraw,
  useSubmissionProperties,
  uploadSubmissionPhoto,
}))
// The language switcher in the header uses the profile mutation; stub it so this
// public-page test needs no QueryClientProvider.
vi.mock('@/hooks/useSettings', () => ({ useUpdateProfile: () => ({ mutate: vi.fn() }) }))

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/submit/inv_abc_def']}>
      <Routes>
        <Route path="/submit/:token" element={<VendorSubmit />} />
      </Routes>
    </MemoryRouter>,
  )

/** The form starts with one blank line item; fill it in. */
function fillFirstLine(description: string, total: string) {
  fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: description } })
  fireEvent.change(screen.getByPlaceholderText('Total'), { target: { value: total } })
}

const submitMock = { mutate: vi.fn(), isPending: false, error: null as unknown }

// The two locale tests below leave the app in zh; reset afterwards so sibling
// suites still see English.
afterEach(() => i18n.changeLanguage('en'))

describe('VendorSubmit', () => {
  // The page forces English on mount. The switch is stubbed out so a stray zh
  // state from another suite can't leak in, and everything is asserted against
  // the English catalogue.
  beforeEach(() => {
    vi.spyOn(i18n, 'changeLanguage').mockResolvedValue(((key: string) => key) as never)
    vi.clearAllMocks()
    submitMock.error = null
    useSubmit.mockReturnValue(submitMock)
    useWithdraw.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useSubmissionProperties.mockReturnValue({
      data: { data: [{ id: 'p1', name: 'Maple', address: '12 Main St' }] },
    })
  })

  it('opens in English even when the app was last used in Cantonese', async () => {
    vi.mocked(i18n.changeLanguage).mockRestore()
    await i18n.changeLanguage('zh')
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(screen.getByRole('heading', { name: 'Submit an invoice' })).toBeDefined()
  })

  it('leaves the vendor on Cantonese if they pick it from the in-page switcher', async () => {
    vi.mocked(i18n.changeLanguage).mockRestore()
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    await waitFor(() => expect(i18n.language).toBe('en'))

    fireEvent.click(screen.getByRole('button', { name: '粵語' }))
    await waitFor(() => expect(i18n.language).toBe('zh'))
    // The forced switch is once-per-visit, so it must not stomp the choice back.
    expect(screen.getByRole('heading', { name: '交發票' })).toBeDefined()
  })

  it('shows a loading state while the token resolves', () => {
    useSubmissionStatus.mockReturnValue({ isPending: true })
    renderPage()
    expect(screen.getByText('Loading…')).toBeDefined()
  })

  it('shows a dead-link state and no form when the token is invalid', () => {
    useSubmissionStatus.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError('NOT_FOUND', 'x', 404),
    })
    renderPage()
    expect(screen.getByText('This link is no longer active')).toBeDefined()
    expect(screen.queryByLabelText('Description')).toBeNull()
  })

  it('renders the submit form + empty state for a valid token with no submissions', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    expect(screen.getByLabelText('Description')).toBeDefined()
    expect(screen.getByText(/no submissions yet/i)).toBeDefined()
    // Submit is disabled with no photo/values.
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('offers exactly the properties assigned to this vendor', () => {
    useSubmissionProperties.mockReturnValue({
      isSuccess: true,
      data: {
        data: [
          { id: 'p1', name: 'Maple', address: '12 Main St' },
          { id: 'p2', name: 'Oak', address: '30 Elm Ave' },
        ],
      },
    })
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    const select = screen.getByLabelText(/property/i) as HTMLSelectElement
    // The placeholder plus the two assigned properties, and nothing else — the
    // endpoint is scoped, so the landlord's other addresses never reach here.
    expect([...select.options].map((o) => o.value)).toEqual(['', 'p1', 'p2'])
  })

  it('replaces the form with a "contact your landlord" panel when none are assigned', () => {
    useSubmissionProperties.mockReturnValue({ isSuccess: true, data: { data: [] } })
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    expect(screen.getByText('No properties assigned yet')).toBeDefined()
    // A property is required to submit, so the form would be a dead end.
    expect(screen.queryByLabelText('Description')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    // The vendor can still see their history.
    expect(screen.getByText(/your submissions/i)).toBeDefined()
  })

  it('keeps the form when the property fetch fails, rather than blaming the landlord', () => {
    // isSuccess false — a failed request must not be misread as "none assigned".
    useSubmissionProperties.mockReturnValue({ isSuccess: false, isError: true, data: undefined })
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    expect(screen.queryByText('No properties assigned yet')).toBeNull()
    expect(screen.getByLabelText('Description')).toBeDefined()
  })

  it('renders submissions with statuses and a resubmit affordance on rejected ones', () => {
    useSubmissionStatus.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        data: [
          {
            id: '1',
            status: 'SUBMITTED',
            amount: '100.00',
            description: 'a',
            invoiceDate: '2026-06-01',
            rejectionReason: null,
            createdAt: '2026-06-01',
          },
          {
            id: '2',
            status: 'REJECTED',
            amount: '50.00',
            description: 'b',
            invoiceDate: '2026-06-01',
            rejectionReason: 'Wrong amount',
            createdAt: '2026-06-01',
          },
        ],
      },
    })
    renderPage()
    expect(screen.getByText('Submitted')).toBeDefined()
    expect(screen.getByText('Rejected')).toBeDefined()
    expect(screen.getByText(/Rejected: Wrong amount/)).toBeDefined()
    expect(screen.getByRole('button', { name: /submit a new invoice to resubmit/i })).toBeDefined()
    // SUBMITTED rows offer withdraw.
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDefined()
  })

  it('enables submit after a photo is added and sends an images[] payload', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    uploadSubmissionPhoto.mockResolvedValue('https://blob.example/owners/c/p.jpg')
    const { container } = renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })

    // Upload a photo via the hidden file input (the second one — camera, then file).
    const fileInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    const file = new File(['x'], 'p.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ description: 'Fixed a leak', quantity: 1, total: 120 }],
        invoiceDate: '2026-06-01',
        images: [{ url: 'https://blob.example/owners/c/p.jpg', type: 'OTHER' }],
      }),
      expect.anything(),
    )
  })

  it('lets the vendor retype a photo and submits the chosen type', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    uploadSubmissionPhoto.mockResolvedValue('https://blob.example/owners/c/p.jpg')
    const { container } = renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })
    const fileInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
    })

    // Once uploaded, a per-photo type select appears; retype it to PARTS.
    await waitFor(() => expect(screen.getByLabelText('Type for photo 1')).toBeDefined())
    fireEvent.change(screen.getByLabelText('Type for photo 1'), { target: { value: 'PARTS' } })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ url: 'https://blob.example/owners/c/p.jpg', type: 'PARTS' }],
      }),
      expect.anything(),
    )
  })

  it('itemizes: adds a line, totals them, and sends every line', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    uploadSubmissionPhoto.mockResolvedValue('https://blob.example/owners/c/p.jpg')
    const { container } = renderPage()

    fillFirstLine('Labour', '150')
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
    const descriptions = screen.getAllByPlaceholderText('Description')
    const totals = screen.getAllByPlaceholderText('Total')
    fireEvent.change(descriptions[1], { target: { value: 'Valve' } })
    fireEvent.change(totals[1], { target: { value: '25.50' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })

    // The running total mirrors the landlord form.
    expect(screen.getByText('$175.50')).toBeDefined()

    const fileInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { description: 'Labour', quantity: 1, total: 150 },
          { description: 'Valve', quantity: 1, total: 25.5 },
        ],
      }),
      expect.anything(),
    )
  })

  it('sends notes and parts ordered when filled', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    uploadSubmissionPhoto.mockResolvedValue('https://blob.example/owners/c/p.jpg')
    const { container } = renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: 'Gate code 1234' } })
    fireEvent.change(screen.getByLabelText(/^Parts ordered/), { target: { value: 'Cartridge' } })

    const fileInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Gate code 1234', partsOrdered: 'Cartridge' }),
      expect.anything(),
    )
  })

  it('submits with no photo, notes or parts — only a dated line is required', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })

    // No photo attached at all.
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    const body = submitMock.mutate.mock.calls[0][0]
    expect(body.images).toBeUndefined()
    expect(body.notes).toBeUndefined()
    expect(body.partsOrdered).toBeUndefined()
  })

  it('steps the quantity up and down, never below one', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    const qty = () => (screen.getByLabelText('Qty') as HTMLInputElement).value
    expect(qty()).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity on line 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity on line 1' }))
    expect(qty()).toBe('3')

    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity on line 1' }))
    expect(qty()).toBe('2')

    // Floor at 1: the decrement is disabled rather than walking to zero.
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity on line 1' }))
    expect(qty()).toBe('1')
    expect(
      (screen.getByRole('button', { name: 'Decrease quantity on line 1' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('adds a line from the inline plus control', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    expect(screen.getAllByPlaceholderText('Description')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
    expect(screen.getAllByPlaceholderText('Description')).toHaveLength(2)
  })

  it('labels the optional fields as optional', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    for (const label of [/^Notes/, /^Parts ordered/, /^Photos/]) {
      expect(screen.getByText(label).textContent).toContain('(optional)')
    }
  })

  it('sends an optional category and property, both chosen from a select', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: 'REPAIRS' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'REPAIRS', propertyId: 'p1' }),
      expect.anything(),
    )
  })

  it('omits category when left unspecified — property is required', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()

    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    const body = submitMock.mutate.mock.calls[0][0]
    expect(body.category).toBeUndefined()
    expect(body.propertyId).toBe('p1')
  })

  it('offers no vendor field — the name comes from the link', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    expect(screen.queryByLabelText(/vendor/i)).toBeNull()
  })

  it('shows a distinct rate-limit message on a 429', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    submitMock.error = new ApiError('TOO_MANY_REQUESTS', 'Too many requests', 429)
    renderPage()
    expect(screen.getByText(/submitted too many times/i)).toBeDefined()
  })

  /**
   * Draft persistence. The scenario is a phone call, a backgrounded tab or a
   * flat battery mid-form — the failure nobody reports, because a vendor who
   * loses a half-filled invoice texts it instead, exactly as they did before
   * the link existed. Unmount/remount stands in for the reload.
   */
  it('gives the vendor their unfinished invoice back after a reload', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    const first = renderPage()
    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: 'Gate code 1234' } })
    first.unmount()

    renderPage()

    expect((screen.getByPlaceholderText('Description') as HTMLInputElement).value).toBe(
      'Fixed a leak',
    )
    expect((screen.getByLabelText('Invoice date') as HTMLInputElement).value).toBe('2026-06-01')
    expect((screen.getByLabelText(/^Notes/) as HTMLTextAreaElement).value).toBe('Gate code 1234')
  })

  it('says so when it restores a draft, rather than repopulating silently', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    const first = renderPage()
    fillFirstLine('Fixed a leak', '120')
    first.unmount()

    renderPage()

    // Silently refilled fields would leave the vendor unsure whether this is
    // this job's invoice or last week's — and clearing it costs what it saved.
    expect(screen.getByText(/kept the invoice you started/i)).toBeDefined()
  })

  it('does not announce a draft on a first, clean visit', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderPage()
    expect(screen.queryByText(/kept the invoice you started/i)).toBeNull()
  })

  it('forgets the draft once the invoice is submitted', async () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    submitMock.mutate.mockImplementation((_payload: unknown, opts: { onSuccess: () => void }) =>
      opts.onSuccess(),
    )
    const first = renderPage()
    fillFirstLine('Fixed a leak', '120')
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/^Property/), { target: { value: 'p1' } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    first.unmount()

    renderPage()

    // A sent invoice is not an unfinished one; restoring it would invite a duplicate.
    expect((screen.getByPlaceholderText('Description') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText(/kept the invoice you started/i)).toBeNull()
  })

  /**
   * The 16px rule, asserted on the one surface that provably needs it.
   *
   * Mobile Safari zooms the viewport when a focused input's font-size is under
   * 16px and does not zoom back out on blur, so a vendor filling this form in
   * the field pans a magnified page for the rest of the visit. `fieldClass`
   * documents the rule; nothing enforced it, and it had already been lost once
   * — Settings shipped a hand-rolled copy that dropped `text-base` (DEC-042
   * era, fixed separately).
   *
   * This guards the vendor submission route specifically, because that is where
   * the evidence is: vendors are on phones by construction — the link is their
   * whole interface. The landlord's screens carry the same latent defect and are
   * deliberately not covered here; nobody has been observed using them on a
   * phone, and a guard over screens with no mobile users would be enforcement
   * without a reason.
   *
   * The assertion is on classes because jsdom applies no CSS — a font-size the
   * browser would compute is simply not observable here.
   */
  const SMALL_TEXT = /^(?:text-xs|text-sm)$/

  it('gives every text-entry control on the vendor form at least 16px on a phone', () => {
    useSubmissionStatus.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    const { container } = renderPage()

    const controls = [...container.querySelectorAll('input, select, textarea')].filter((el) => {
      // File and checkbox inputs open no keyboard, so they cannot trigger the zoom.
      const type = el.getAttribute('type')
      return type !== 'file' && type !== 'checkbox' && type !== 'radio'
    })
    expect(controls.length).toBeGreaterThan(0)

    const offenders = controls
      .filter((el) =>
        // An unprefixed text-sm/text-xs applies at every width, phones included.
        // A breakpoint-prefixed one (md:text-sm) is the intended shape and fine.
        [...el.classList].some((c) => SMALL_TEXT.test(c)),
      )
      .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">`)

    expect(offenders).toEqual([])
  })
})
