import { describe, it, expect, afterEach, vi } from 'vitest'
import { compressImage } from '@/lib/compressImage'

/**
 * jsdom implements neither `createImageBitmap` nor a real canvas encoder, so the
 * decode/encode pair is stubbed per test. That is the honest shape here: what is
 * worth asserting is not that the browser can resize a JPEG — it can — but that
 * every failure path hands the ORIGINAL file back. A vendor on field LTE must
 * never lose an upload because the optimisation for it failed.
 */

const big = (bytes: number, name = 'receipt.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(bytes)], name, { type })

type BitmapStub = { width: number; height: number; close: () => void }

function stubDecode(bitmap: BitmapStub | Error) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => (bitmap instanceof Error ? Promise.reject(bitmap) : Promise.resolve(bitmap))),
  )
}

/** Stub canvas 2d + toBlob, returning a blob of `outBytes` (or null to fail). */
function stubCanvas(outBytes: number | null) {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(outBytes === null ? null : new Blob([new Uint8Array(outBytes)], { type: 'image/jpeg' }))
  } as HTMLCanvasElement['toBlob'])
  return { drawImage }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compressImage', () => {
  it('leaves a small file untouched without even decoding it', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const file = big(100 * 1024)

    expect(await compressImage(file)).toBe(file)
    expect(decode).not.toHaveBeenCalled()
  })

  it('scales a large photo to a 2000px long edge and returns a smaller JPEG', async () => {
    stubDecode({ width: 4032, height: 3024, close: () => {} })
    const { drawImage } = stubCanvas(300 * 1024)
    const file = big(4 * 1024 * 1024, 'IMG_0042.HEIC', 'image/heic')

    const out = await compressImage(file)

    expect(out).not.toBe(file)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0042.jpg')
    expect(out.size).toBeLessThan(file.size)
    // 4032x3024 scaled so the long edge is 2000 => 2000x1500, aspect preserved.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500)
  })

  it('never upscales an image whose long edge is already under the cap', async () => {
    stubDecode({ width: 1200, height: 900, close: () => {} })
    const { drawImage } = stubCanvas(200 * 1024)

    await compressImage(big(2 * 1024 * 1024))

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 900)
  })

  it('returns the original when the browser cannot decode the format', async () => {
    // HEIC outside Safari: createImageBitmap rejects.
    stubDecode(new Error('unsupported image type'))
    const file = big(5 * 1024 * 1024, 'IMG_1.HEIC', 'image/heic')

    expect(await compressImage(file)).toBe(file)
  })

  it('returns the original when re-encoding produces no blob', async () => {
    stubDecode({ width: 4032, height: 3024, close: () => {} })
    stubCanvas(null)
    const file = big(4 * 1024 * 1024)

    expect(await compressImage(file)).toBe(file)
  })

  it('returns the original when re-encoding would make the file bigger', async () => {
    stubDecode({ width: 4032, height: 3024, close: () => {} })
    stubCanvas(9 * 1024 * 1024)
    const file = big(4 * 1024 * 1024)

    expect(await compressImage(file)).toBe(file)
  })

  it('releases the decoded bitmap even when encoding fails', async () => {
    const close = vi.fn()
    stubDecode({ width: 4032, height: 3024, close })
    stubCanvas(null)

    await compressImage(big(4 * 1024 * 1024))

    expect(close).toHaveBeenCalled()
  })
})
