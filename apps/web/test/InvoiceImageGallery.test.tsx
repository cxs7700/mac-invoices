import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InvoiceImageGallery } from '@/components/InvoiceImageGallery'
import { ApiError } from '@/lib/apiClient'

const { useInvoiceImages, useAddInvoiceImage, useRemoveInvoiceImage, useSetInvoiceImageType } =
  vi.hoisted(() => ({
    useInvoiceImages: vi.fn(),
    useAddInvoiceImage: vi.fn(),
    useRemoveInvoiceImage: vi.fn(),
    useSetInvoiceImageType: vi.fn(),
  }))
vi.mock('@/hooks/useInvoiceImages', () => ({
  useInvoiceImages,
  useAddInvoiceImage,
  useRemoveInvoiceImage,
  useSetInvoiceImageType,
}))

const add = { mutate: vi.fn(), isPending: false, error: null as unknown }
const remove = { mutate: vi.fn(), isPending: false }
const setType = { mutate: vi.fn(), isPending: false }

const image = (id: string, type = 'OTHER') => ({
  id,
  url: `https://signed/${id}`,
  type,
  caption: null,
  createdAt: '2026-06-01',
})

function renderGallery() {
  return render(<InvoiceImageGallery invoiceId="inv1" />)
}

describe('InvoiceImageGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    add.error = null
    useAddInvoiceImage.mockReturnValue(add)
    useRemoveInvoiceImage.mockReturnValue(remove)
    useSetInvoiceImageType.mockReturnValue(setType)
  })

  it('shows a loading state', () => {
    useInvoiceImages.mockReturnValue({ isPending: true })
    renderGallery()
    expect(screen.getByText('Loading photos…')).toBeDefined()
  })

  it('renders a thumbnail per image with a bilingual-ready type select', () => {
    useInvoiceImages.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: [image('a', 'CASH'), image('b')] },
    })
    renderGallery()
    expect(screen.getAllByAltText('Invoice photo')).toHaveLength(2)
    // The type select renders translated option labels (en).
    expect(screen.getAllByRole('option', { name: 'Cash' }).length).toBeGreaterThan(0)
  })

  it('changes a photo type via PATCH', () => {
    useInvoiceImages.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: [image('a')] },
    })
    renderGallery()
    fireEvent.change(screen.getByLabelText('Photo type'), { target: { value: 'CHECK' } })
    expect(setType.mutate).toHaveBeenCalledWith({ imageId: 'a', type: 'CHECK' })
  })

  it('removes a photo only after an inline confirm', () => {
    useInvoiceImages.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: [image('a')] },
    })
    renderGallery()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    // Confirm appears; DELETE not yet sent.
    expect(remove.mutate).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(confirm[confirm.length - 1])
    expect(remove.mutate).toHaveBeenCalledWith('a', expect.anything())
  })

  it('disables the add control with at-cap copy at the limit', () => {
    useInvoiceImages.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: ['a', 'b', 'c', 'd', 'e'].map((id) => image(id)) },
    })
    renderGallery()
    expect(screen.getByText(/Maximum of 5 photos reached/i)).toBeDefined()
    // The upload affordance is gone at the cap.
    expect(screen.queryByRole('button', { name: /Take photo/i })).toBeNull()
  })

  it('surfaces a cap-422 message from a failed add', () => {
    useInvoiceImages.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: [image('a')] },
    })
    add.error = new ApiError('IMAGE_LIMIT', 'too many', 422)
    renderGallery()
    expect(screen.getByText(/at most 5 photos/i)).toBeDefined()
  })
})
