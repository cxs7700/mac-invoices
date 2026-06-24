import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Contractors from '@/pages/Contractors'

const { useContractors, useCreateContractor, useRevokeLink, useRegenerateLink } = vi.hoisted(() => ({
  useContractors: vi.fn(),
  useCreateContractor: vi.fn(),
  useRevokeLink: vi.fn(),
  useRegenerateLink: vi.fn(),
}))
vi.mock('@/hooks/useContractors', () => ({
  useContractors,
  useCreateContractor,
  useRevokeLink,
  useRegenerateLink,
}))

const contractor = (over = {}) => ({
  id: 'c1',
  name: 'Joe Plumber',
  contact: '555-1234',
  linkActive: true,
  lastUsedAt: null,
  createdAt: '2026-06-01',
  ...over,
})

const createMutate = vi.fn()
const regenerateMutate = vi.fn()
const revokeMutate = vi.fn()

describe('Contractors page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreateContractor.mockReturnValue({ mutate: createMutate, isPending: false, error: null })
    useRevokeLink.mockReturnValue({ mutate: revokeMutate, isPending: false })
    useRegenerateLink.mockReturnValue({ mutate: regenerateMutate, isPending: false })
  })

  it('shows the empty state before any contractor is added', () => {
    useContractors.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    render(<Contractors />)
    expect(screen.getByText(/no contractors yet/i)).toBeDefined()
  })

  it('submits a new contractor with name + contact', () => {
    useContractors.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    render(<Contractors />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pat' } })
    fireEvent.change(screen.getByLabelText(/contact/i), { target: { value: 'pat@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add contractor' }))
    expect(createMutate).toHaveBeenCalledWith(
      { name: 'Pat', contact: 'pat@x.com' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('reveals the link once on regenerate, then hides it on "Done"', () => {
    useContractors.mockReturnValue({ data: { data: [contractor()] }, isPending: false, isError: false })
    // Regenerate fires its onSuccess with the new link.
    regenerateMutate.mockImplementation((_id, opts) =>
      opts.onSuccess({ ...contractor(), link: 'http://app/submit/inv_new_secret' }),
    )
    render(<Contractors />)
    fireEvent.click(screen.getByRole('button', { name: /regenerate link/i }))
    expect(screen.getByText('http://app/submit/inv_new_secret')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /done — i copied it/i }))
    expect(screen.queryByText('http://app/submit/inv_new_secret')).toBeNull()
  })

  it('offers revoke on an active link', () => {
    useContractors.mockReturnValue({ data: { data: [contractor()] }, isPending: false, isError: false })
    render(<Contractors />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(revokeMutate).toHaveBeenCalledWith('c1')
  })
})
