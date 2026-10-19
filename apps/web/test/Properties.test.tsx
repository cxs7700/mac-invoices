import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Properties from '@/pages/Properties'
import { ApiError } from '@/lib/apiClient'

const { useProperties, useCreateProperty, useDeleteProperty } = vi.hoisted(() => ({
  useProperties: vi.fn(),
  useCreateProperty: vi.fn(),
  useDeleteProperty: vi.fn(),
}))
vi.mock('@/hooks/useProperties', () => ({ useProperties, useCreateProperty, useDeleteProperty }))

const createMutate = vi.fn()
const deleteMutate = vi.fn()

const property = (over = {}) => ({
  id: 'p1',
  name: 'Maple Duplex',
  address: '1 Maple Ave',
  notes: null,
  createdAt: '2026-06-01',
  ...over,
})

const OWNER_PAYLOAD = {
  ownerFirstName: 'Olive',
  ownerLastName: 'Owner',
  ownerEmail: 'olive@example.com',
  ownerPhone: undefined,
}

/** Fill the required owner block (name + email; phone left blank). */
function fillOwner() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Olive' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Owner' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'olive@example.com' } })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Properties />
    </MemoryRouter>,
  )
}

describe('Properties page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreateProperty.mockReturnValue({ mutate: createMutate, isPending: false, error: null })
    useDeleteProperty.mockReturnValue({ mutate: deleteMutate, isPending: false })
  })

  it('shows the empty state before any property', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    expect(screen.getByText(/no properties yet/i)).toBeDefined()
  })

  it('submits a new property with name + address + notes', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: 'Lake House' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '9 Lake Rd' } })
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'cabin' } })
    fillOwner()
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }))
    expect(createMutate).toHaveBeenCalledWith(
      { name: 'Lake House', address: '9 Lake Rd', notes: 'cabin', ...OWNER_PAYLOAD },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('submits with only an address (name omitted) — name is optional', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '9 Lake Rd' } })
    fillOwner()
    const submit = screen.getByRole('button', { name: 'Add property' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(createMutate).toHaveBeenCalledWith(
      { name: undefined, address: '9 Lake Rd', notes: undefined, ...OWNER_PAYLOAD },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('requires the owner name and email before a property can be added', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '9 Lake Rd' } })
    const submit = screen.getByRole('button', { name: 'Add property' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Olive' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Owner' } })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'olive@example.com' } })
    expect(submit.hasAttribute('disabled')).toBe(false)
  })

  it('explains the block, and rejects an email the server would (a@b), not just a blank one', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '9 Lake Rd' } })
    fillOwner()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@localhost' } })
    const submit = screen.getByRole('button', { name: 'Add property' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/a valid email are required/i)).toBeDefined()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    expect(submit.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/a valid email are required/i)).toBeNull()
  })

  it('sends the optional owner phone when given', () => {
    useProperties.mockReturnValue({ data: { data: [] }, isPending: false, isError: false })
    renderPage()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '9 Lake Rd' } })
    fillOwner()
    fireEvent.change(screen.getByLabelText('Phone (optional)'), {
      target: { value: '555-123-4567' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }))
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerPhone: '555-123-4567' }),
      expect.anything(),
    )
  })

  it('falls back to the address as the label when a property has no name', () => {
    useProperties.mockReturnValue({
      data: { data: [property({ name: '', address: '742 Evergreen Terrace' })] },
      isPending: false,
      isError: false,
    })
    renderPage()
    expect(screen.getByRole('link', { name: '742 Evergreen Terrace' }).getAttribute('href')).toBe(
      '/properties/p1',
    )
  })

  it('lists properties with view/edit links', () => {
    useProperties.mockReturnValue({
      data: { data: [property()] },
      isPending: false,
      isError: false,
    })
    renderPage()
    expect(screen.getByRole('link', { name: 'Maple Duplex' }).getAttribute('href')).toBe(
      '/properties/p1',
    )
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe(
      '/properties/p1/edit',
    )
  })

  it('surfaces the delete-guard error inline with a reassign link', () => {
    useProperties.mockReturnValue({
      data: { data: [property()] },
      isPending: false,
      isError: false,
    })
    // Simulate the API 422 by firing the mutation's onError.
    deleteMutate.mockImplementation((_id, opts) =>
      opts.onError(
        new ApiError(
          'PROPERTY_HAS_INVOICES',
          "Can't delete: 3 invoices assigned. Reassign them first.",
          422,
        ),
      ),
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/3 invoices assigned/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /view its invoices/i }).getAttribute('href')).toBe(
      '/invoices?propertyId=p1',
    )
  })
})
