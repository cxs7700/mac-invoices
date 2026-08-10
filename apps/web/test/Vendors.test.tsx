import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Vendors from '@/pages/Vendors'

const {
  useVendors,
  useCreateVendor,
  useRevokeLink,
  useReissueLink,
  useUpdateVendor,
  useDeleteVendor,
} = vi.hoisted(() => ({
  useVendors: vi.fn(),
  useCreateVendor: vi.fn(),
  useRevokeLink: vi.fn(),
  useReissueLink: vi.fn(),
  useUpdateVendor: vi.fn(),
  useDeleteVendor: vi.fn(),
}))
vi.mock('@/hooks/useVendors', () => ({
  useVendors,
  useCreateVendor,
  useRevokeLink,
  useReissueLink,
  useUpdateVendor,
  useDeleteVendor,
}))

const LINK = 'http://app/submit/inv_abc_secret'

const vendor = (over = {}) => ({
  id: 'c1',
  name: 'Joe Plumber',
  phone: '5551234567',
  email: null,
  linkActive: true,
  link: LINK,
  lastUsedAt: null,
  createdAt: '2026-06-01',
  ...over,
})

const createMutate = vi.fn()
const reissueMutate = vi.fn()
const revokeMutate = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()

function listing(vendors: unknown[]) {
  useVendors.mockReturnValue({ data: { data: vendors }, isPending: false, isError: false })
}

describe('Vendors page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreateVendor.mockReturnValue({ mutate: createMutate, isPending: false, error: null })
    useRevokeLink.mockReturnValue({ mutate: revokeMutate, isPending: false })
    useReissueLink.mockReturnValue({ mutate: reissueMutate, isPending: false })
    useDeleteVendor.mockReturnValue({ mutate: deleteMutate, isPending: false })
    useUpdateVendor.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
      error: null,
      variables: undefined,
    })
  })

  it('shows the empty state before any vendor is added', () => {
    listing([])
    render(<Vendors />)
    expect(screen.getByText(/no vendors yet/i)).toBeDefined()
  })

  it('submits a new vendor with separate phone and email', async () => {
    listing([])
    render(<Vendors />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Ace Plumbing' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555-0100' } })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ace@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /add vendor/i }))

    await waitFor(() =>
      expect(createMutate).toHaveBeenCalledWith(
        { name: 'Ace Plumbing', phone: '555-0100', email: 'ace@example.com' },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    )
  })

  it('blocks submit when both phone and email are empty', async () => {
    listing([])
    render(<Vendors />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'No Contact' } })
    fireEvent.click(screen.getByRole('button', { name: /add vendor/i }))

    expect(await screen.findByText(/phone number or an email/i)).toBeDefined()
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('shows the link on every row and copies it on demand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    listing([vendor()])
    render(<Vendors />)

    // The link is present without any prior create/regenerate step.
    expect(screen.getByText(LINK)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: "Copy Joe Plumber's submission link" }))
    expect(writeText).toHaveBeenCalledWith(LINK)
  })

  it('displays the phone in 123-456-7890 form', () => {
    listing([vendor()])
    render(<Vendors />)
    expect(screen.getByText(/555-123-4567/)).toBeDefined()
  })

  it('edits a vendor’s contact details in place', () => {
    listing([vendor({ phone: null, email: null })])
    render(<Vendors />)

    // An auto-created vendor starts with neither field.
    expect(screen.getByText(/no phone or email yet/i)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: "Edit Joe Plumber's contact details" }))
    fireEvent.change(screen.getByLabelText(/phone/i, { selector: '#phone-c1' }), {
      target: { value: '5551234567' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(updateMutate).toHaveBeenCalledWith({ id: 'c1', phone: '5551234567', email: null })
  })

  it('offers revoke on an active link and no regenerate button', () => {
    listing([vendor()])
    render(<Vendors />)

    // Regenerating is no longer part of the everyday flow.
    expect(screen.queryByRole('button', { name: /regenerate/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(revokeMutate).toHaveBeenCalledWith('c1')
  })

  it('offers a replacement link only once revoked, and hides the dead link', () => {
    listing([vendor({ linkActive: false, link: null })])
    render(<Vendors />)

    expect(screen.queryByText(LINK)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /issue new link/i }))
    expect(reissueMutate).toHaveBeenCalledWith('c1')
  })

  it('deletes a vendor, but only after confirming', () => {
    listing([vendor()])
    render(<Vendors />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Joe Plumber' }))
    // The X asks first — deleting is not undoable.
    expect(deleteMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/delete joe plumber\?/i)).toBeDefined()
    // And it says what happens to their invoices.
    expect(screen.getByText(/invoices are kept/i)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Delete vendor' }))
    expect(deleteMutate).toHaveBeenCalledWith('c1')
  })

  it('backs out of a delete without calling the mutation', () => {
    listing([vendor()])
    render(<Vendors />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Joe Plumber' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/delete joe plumber\?/i)).toBeNull()
    expect(deleteMutate).not.toHaveBeenCalled()
  })
})
