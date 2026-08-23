import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The upload token is minted with `allowedContentTypes: [contentType]` and
 * pinned to one pathname (apps/api/src/integrations/storage.ts). So compressing
 * a HEIC into a JPEG *after* the token is issued mints permission for a file
 * that no longer exists and the PUT is rejected — a failure that only appears
 * on a real device with a real HEIC, i.e. exactly the vendor path nobody runs
 * locally. These tests pin the ordering instead.
 */

const { apiClient, put, compressImage } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  put: vi.fn(),
  compressImage: vi.fn(),
}))
vi.mock('@/lib/apiClient', () => ({ apiClient, ApiError: class extends Error {} }))
vi.mock('@vercel/blob/client', () => ({ put }))
vi.mock('@/lib/compressImage', () => ({ compressImage }))

const { uploadSubmissionPhoto } = await import('@/hooks/useSubmission')
const { uploadInvoicePhoto } = await import('@/hooks/useImageUpload')

const heic = new File([new Uint8Array(4 * 1024 * 1024)], 'IMG_1.HEIC', { type: 'image/heic' })
const jpeg = new File([new Uint8Array(300 * 1024)], 'IMG_1.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.clearAllMocks()
  apiClient.mockResolvedValue({ token: 'client-token', pathname: 'owners/u1/uuid' })
  put.mockResolvedValue({ url: 'https://blob.example/owners/u1/uuid' })
})

describe.each([
  ['vendor submission', () => uploadSubmissionPhoto('link-token', heic)],
  ['authed invoice', () => uploadInvoicePhoto(heic)],
])('%s upload', (_name, run) => {
  it('mints the token for the COMPRESSED type, not the original', async () => {
    compressImage.mockResolvedValue(jpeg)

    await run()

    expect(compressImage).toHaveBeenCalledWith(heic)
    // The token request must describe the bytes that will actually be PUT.
    const body = JSON.parse(apiClient.mock.calls[0][1].body)
    expect(body.contentType).toBe('image/jpeg')
    // And compression must have happened first.
    expect(compressImage.mock.invocationCallOrder[0]).toBeLessThan(
      apiClient.mock.invocationCallOrder[0],
    )
  })

  it('uploads the compressed file, not the original', async () => {
    compressImage.mockResolvedValue(jpeg)

    await run()

    expect(put).toHaveBeenCalledWith('owners/u1/uuid', jpeg, expect.objectContaining({
      contentType: 'image/jpeg',
    }))
  })

  it('still uploads the original, consistently typed, when compression declines', async () => {
    // compressImage returns the input untouched on every failure path.
    compressImage.mockResolvedValue(heic)

    await run()

    const body = JSON.parse(apiClient.mock.calls[0][1].body)
    expect(body.contentType).toBe('image/heic')
    expect(put).toHaveBeenCalledWith('owners/u1/uuid', heic, expect.objectContaining({
      contentType: 'image/heic',
    }))
  })
})
