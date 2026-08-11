import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VendorPropertiesEditor } from '@/components/VendorPropertiesEditor'

const { useProperties, useVendorProperties, useSetVendorProperties } = vi.hoisted(() => ({
  useProperties: vi.fn(),
  useVendorProperties: vi.fn(),
  useSetVendorProperties: vi.fn(),
}))
vi.mock('@/hooks/useProperties', () => ({ useProperties }))
vi.mock('@/hooks/useVendors', () => ({ useVendorProperties, useSetVendorProperties }))

const ALL = [
  { id: 'p1', name: 'Maple', address: '12 Main St' },
  { id: 'p2', name: 'Oak', address: '30 Elm Ave' },
]

const save = { mutate: vi.fn(), isPending: false, error: null as unknown }

const ready = (assigned: typeof ALL) => {
  useProperties.mockReturnValue({ isPending: false, isError: false, data: { data: ALL } })
  useVendorProperties.mockReturnValue({
    isPending: false,
    isError: false,
    data: { data: assigned },
  })
}

const renderEditor = () => render(<VendorPropertiesEditor vendorId="v1" />)

describe('VendorPropertiesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    save.error = null
    useSetVendorProperties.mockReturnValue(save)
  })

  it('checks the properties already assigned', () => {
    ready([ALL[0]])
    renderEditor()

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, false])
  })

  it('saves the whole set, not a delta', () => {
    ready([ALL[0]])
    renderEditor()

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // Both ids — the endpoint replaces, so a delta would silently unassign p1.
    expect(save.mutate).toHaveBeenCalledWith(['p1', 'p2'])
  })

  it('keeps Save disabled until something actually changes', () => {
    ready([ALL[0]])
    renderEditor()

    const button = () => screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(button().disabled).toBe(true)

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(button().disabled).toBe(false)

    // Toggling back to the server state is not a change.
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(button().disabled).toBe(true)
  })

  it('warns when the landlord clears every property', () => {
    ready([ALL[0]])
    renderEditor()

    expect(screen.queryByText(/can't submit an invoice/i)).toBeNull()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    // Unassigning everything disables the vendor's link, so say so before saving.
    expect(screen.getByText(/can't submit an invoice/i)).toBeDefined()
  })

  it('points the landlord at the Properties page when they have none', () => {
    useProperties.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    useVendorProperties.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderEditor()

    expect(screen.getByText(/haven't added any properties yet/i)).toBeDefined()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('surfaces a load failure instead of an empty checkbox list', () => {
    useProperties.mockReturnValue({ isPending: false, isError: true })
    useVendorProperties.mockReturnValue({ isPending: false, isError: false, data: { data: [] } })
    renderEditor()

    expect(screen.getByText("Couldn't load properties.")).toBeDefined()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
