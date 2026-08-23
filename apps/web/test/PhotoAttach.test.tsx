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

  it('uploads a valid file and reports the stored url plus a local preview', async () => {
    validateImageFile.mockReturnValue(null)
    uploadInvoicePhoto.mockResolvedValue('https://blob/url')
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-1')
    const onUploaded = vi.fn()
    const file = new File(['x'], 'inv.jpg', { type: 'image/jpeg' })
    const { container } = render(<PhotoAttach onUploaded={onUploaded} />)

    pickFile(container, file)

    // The stored URL is what gets submitted; the preview is what can actually
    // be rendered, because the blob store is private and 403s an unsigned img.
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith('https://blob/url', 'blob:preview-1'),
    )
    expect(objectUrl).toHaveBeenCalledWith(file)
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

/**
 * Concurrency is opt-in, because the two landlord callers must not get it:
 * `InvoiceNew` keeps a single URL that a second upload would overwrite.
 */
describe('PhotoAttach — capture while an upload is in flight', () => {
  const jpg = () => new File(['x'], 'inv.jpg', { type: 'image/jpeg' })
  /** An upload that stays pending until the test resolves it. */
  const pending = () => {
    let resolve!: (url: string) => void
    const promise = new Promise<string>((r) => (resolve = r))
    return { promise, resolve }
  }

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: these tests queue implementations with
    // mockReturnValueOnce, and clearAllMocks leaves that queue intact. A test
    // that bails before consuming its queue would otherwise hand its leftover
    // promise to the next one, making failures order-dependent.
    vi.resetAllMocks()
    validateImageFile.mockReturnValue(null)
  })

  const takeButton = () => screen.getByRole('button', { name: /take/i })

  it('keeps the capture buttons live during an upload when slots remain', async () => {
    const first = pending()
    uploadInvoicePhoto.mockReturnValueOnce(first.promise)
    const { container } = render(<PhotoAttach onUploaded={vi.fn()} remainingSlots={5} />)

    pickFile(container, jpg())
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined())
    // The whole point: the vendor can shoot the next receipt while this one uploads.
    expect(takeButton().hasAttribute('disabled')).toBe(false)

    first.resolve('https://blob/1')
  })

  it('runs a second upload alongside the first', async () => {
    const a = pending()
    const b = pending()
    uploadInvoicePhoto.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const onUploaded = vi.fn()
    const { container } = render(<PhotoAttach onUploaded={onUploaded} remainingSlots={5} />)

    pickFile(container, jpg())
    await waitFor(() => expect(uploadInvoicePhoto).toHaveBeenCalledTimes(1))
    // Assert the gate before driving the second pick. `pickFile` fires straight
    // at the hidden input, so without this the test passes even when the button
    // is disabled and a real vendor could never have started the second upload.
    expect(takeButton().hasAttribute('disabled')).toBe(false)
    pickFile(container, jpg())
    await waitFor(() => expect(uploadInvoicePhoto).toHaveBeenCalledTimes(2))
    // Two progress lines, one per upload in flight.
    expect(screen.getAllByRole('status')).toHaveLength(2)

    b.resolve('https://blob/2')
    a.resolve('https://blob/1')
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
  })

  it('stops starting uploads once in-flight uploads have claimed every slot', async () => {
    const only = pending()
    uploadInvoicePhoto.mockReturnValueOnce(only.promise)
    const { container } = render(<PhotoAttach onUploaded={vi.fn()} remainingSlots={1} />)

    pickFile(container, jpg())
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined())

    // The one free slot is spoken for. Uploading again would push a file to
    // storage that the parent then discards at the cap.
    expect(takeButton().hasAttribute('disabled')).toBe(true)

    only.resolve('https://blob/1')
  })

  it('still blocks during an upload when the caller does not opt in', async () => {
    const first = pending()
    uploadInvoicePhoto.mockReturnValueOnce(first.promise)
    const { container } = render(<PhotoAttach onUploaded={vi.fn()} />)

    pickFile(container, jpg())
    await waitFor(() => expect(screen.getByRole('status')).toBeDefined())
    expect(takeButton().hasAttribute('disabled')).toBe(true)

    first.resolve('https://blob/1')
  })
})
