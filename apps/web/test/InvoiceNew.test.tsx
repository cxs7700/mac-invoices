import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import InvoiceNew from '@/pages/InvoiceNew'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('@/hooks/useCreateInvoice', () => ({
  useCreateInvoice: () => ({ mutate, isPending: false, error: null }),
}))
// Stub the form: a button that submits canned values.
vi.mock('@/components/InvoiceForm', () => ({
  InvoiceForm: ({ onSubmit }: { onSubmit: (v: Record<string, unknown>) => void }) => (
    <button onClick={() => onSubmit({ vendorName: 'V', amount: 100 })}>submit-form</button>
  ),
}))
// Stub PhotoAttach: a button that reports an uploaded url.
vi.mock('@/components/PhotoAttach', () => ({
  PhotoAttach: ({ onUploaded }: { onUploaded: (u: string) => void }) => (
    <button onClick={() => onUploaded('https://blob/url')}>do-attach</button>
  ),
}))

const renderNew = () =>
  render(
    <MemoryRouter>
      <InvoiceNew />
    </MemoryRouter>,
  )

describe('InvoiceNew photo attach', () => {
  beforeEach(() => vi.clearAllMocks())

  it('the dead OCR scan tile is gone', () => {
    renderNew()
    expect(screen.queryByText(/Scan a receipt/i)).toBeNull()
    expect(screen.getByText(/Invoice photo/i)).toBeDefined()
  })

  it('submitting after attaching a photo sends the image url', () => {
    renderNew()
    fireEvent.click(screen.getByText('do-attach'))
    fireEvent.click(screen.getByText('submit-form'))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ image: { url: 'https://blob/url', type: 'OTHER' } }),
      expect.anything(),
    )
  })

  it('submitting without a photo sends no image', () => {
    renderNew()
    fireEvent.click(screen.getByText('submit-form'))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ image: undefined }),
      expect.anything(),
    )
  })
})
