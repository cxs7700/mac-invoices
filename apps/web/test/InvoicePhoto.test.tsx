import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InvoicePhoto } from '@/components/InvoicePhoto'

vi.mock('@/hooks/useInvoiceImage', () => ({
  useInvoiceImageUrl: vi.fn(),
  useAttachInvoiceImage: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveInvoiceImage: () => ({ mutate: vi.fn(), isPending: false }),
}))
import { useInvoiceImageUrl } from '@/hooks/useInvoiceImage'
const mockUrl = useInvoiceImageUrl as unknown as Mock

describe('InvoicePhoto', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the photo with a remove option and opens a full-size lightbox', () => {
    mockUrl.mockReturnValue({ data: { url: 'https://blob/x' }, isError: false, refetch: vi.fn() })
    render(<InvoicePhoto invoiceId="i1" />)
    expect(screen.getByAltText('Invoice photo')).toBeDefined()
    expect(screen.getByText('Remove')).toBeDefined()
    fireEvent.click(screen.getByLabelText('View full-size photo'))
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('shows the attach control when there is no photo', () => {
    mockUrl.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() })
    render(<InvoicePhoto invoiceId="i1" />)
    expect(screen.getByText('Take photo')).toBeDefined()
    expect(screen.queryByAltText('Invoice photo')).toBeNull()
  })
})
