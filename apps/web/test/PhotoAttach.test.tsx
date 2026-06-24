import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PhotoAttach } from '@/components/PhotoAttach'

const { uploadInvoicePhoto, validateImageFile } = vi.hoisted(() => ({
  uploadInvoicePhoto: vi.fn(),
  validateImageFile: vi.fn(),
}))
vi.mock('@/hooks/useImageUpload', () => ({
  uploadInvoicePhoto,
  validateImageFile,
  ACCEPTED_IMAGE_TYPES: ['image/jpeg'],
  MAX_IMAGE_BYTES: 10,
}))

const pickFile = (container: HTMLElement, file: File) => {
  const inputs = container.querySelectorAll('input[type=file]')
  fireEvent.change(inputs[1], { target: { files: [file] } })
}

describe('PhotoAttach', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uploads a valid file and calls onUploaded with the stored url', async () => {
    validateImageFile.mockReturnValue(null)
    uploadInvoicePhoto.mockResolvedValue('https://blob/url')
    const onUploaded = vi.fn()
    const { container } = render(<PhotoAttach onUploaded={onUploaded} />)
    pickFile(container, new File(['x'], 'inv.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('https://blob/url'))
  })

  it('rejects an invalid file with an error and does not upload', async () => {
    validateImageFile.mockReturnValue('Please choose a JPEG, PNG, HEIC, or WebP image.')
    const onUploaded = vi.fn()
    const { container } = render(<PhotoAttach onUploaded={onUploaded} />)
    pickFile(container, new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect(uploadInvoicePhoto).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })
})
