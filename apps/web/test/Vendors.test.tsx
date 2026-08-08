import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Vendors from '@/pages/Vendors'

const { useVendors, useCreateVendor, useRevokeLink, useRegenerateLink } = vi.hoisted(() => ({
  useVendors: vi.fn(),
  useCreateVendor: vi.fn(),
  useRevokeLink: vi.fn(),
  useRegenerateLink: vi.fn(),
}))
vi.mock('@/hooks/useVendors', () => ({
  useVendors,
  useCreateVendor,
  useRevokeLink,
  useRegenerateLink,
}))

const vendor = (over = {}) => ({
  id: 'c1',
  name: 'Joe Plumber',
  phone: '555-1234',
  email: null,
  linkActive: true,
  lastUsedAt: null,
  createdAt: '2026-06-01',
  ...over,
})

const createMutate = vi.fn()
const regenerateMutate = vi.fn()
const revokeMutate = vi.fn()

describe('Vendors page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreateVendor.mockReturnValue({ mutate: createMutate, isPending: false, error: null })
    useRevokeLink.mockReturnValue({ mutate: revokeMutate, isPending: false })
    useRegenerateLink.mockReturnValue({ mutate: regenerateMutate, isPending: false })
  })

  it('shows the empty state before any vendor is added', () => {
    useVendors.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    render(<Vendors />)
    expect(screen.getByText(/no vendors yet/i)).toBeDefined()
  })

  it('submits a new vendor with separate phone and email', async () => {
    useVendors.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
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
    useVendors.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    render(<Vendors />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'No Contact' } })
    fireEvent.click(screen.getByRole('button', { name: /add vendor/i }))

    expect(await screen.findByText(/phone number or an email/i)).toBeDefined()
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('reveals the link once on regenerate, then hides it on "Done"', () => {
    useVendors.mockReturnValue({ data: { data: [vendor()] }, isPending: false, isError: false })
    // Regenerate fires its onSuccess with the new link.
    regenerateMutate.mockImplementation((_id, opts) =>
      opts.onSuccess({ ...vendor(), link: 'http://app/submit/inv_new_secret' }),
    )
    render(<Vendors />)
    fireEvent.click(screen.getByRole('button', { name: /regenerate link/i }))
    expect(screen.getByText('http://app/submit/inv_new_secret')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /done — i copied it/i }))
    expect(screen.queryByText('http://app/submit/inv_new_secret')).toBeNull()
  })

  it('offers revoke on an active link', () => {
    useVendors.mockReturnValue({ data: { data: [vendor()] }, isPending: false, isError: false })
    render(<Vendors />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(revokeMutate).toHaveBeenCalledWith('c1')
  })
})
