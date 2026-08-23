/**
 * Downscale and re-encode a captured photo before it is uploaded.
 *
 * A vendor photographs a receipt on a phone and the camera hands us 3–6 MB of
 * JPEG (or HEIC) at full sensor resolution. Every byte of that crosses field
 * LTE, and the result is displayed as a thumbnail and read as a document — so
 * the resolution is spent on nothing. Downscaling to a 2000px long edge keeps a
 * receipt comfortably legible while typically cutting the payload by an order
 * of magnitude, which shortens the window in which a dropped signal can lose
 * the upload at all.
 *
 * The function never rejects. Every failure path returns the ORIGINAL file, on
 * the principle that a slow upload beats no upload: `createImageBitmap` cannot
 * decode HEIC outside Safari, a canvas can run out of memory on a large image,
 * and `toBlob` can hand back null. In each case the caller proceeds exactly as
 * it did before this module existed.
 *
 * Ordering note, load-bearing: callers must compress BEFORE minting an upload
 * token. `issueUploadToken` pins the token with `allowedContentTypes: [type]`,
 * so a token minted for `image/heic` rejects the `image/jpeg` this produces.
 */

/** Long edge, in px. A receipt stays legible well below a phone's full sensor. */
const MAX_EDGE = 2000
const QUALITY = 0.8

/**
 * Below this, re-encoding is not worth the decode: a small file is already
 * either a screenshot or an image someone else has compressed, and round-
 * tripping it through a lossy encoder costs quality for a trivial saving.
 */
const SKIP_BELOW_BYTES = 512 * 1024

/** `receipt.heic` -> `receipt.jpg`; a name with no extension gains one. */
function toJpegName(name: string): string {
  return /\.[^./\\]+$/.test(name) ? name.replace(/\.[^./\\]+$/, '.jpg') : `${name}.jpg`
}

/**
 * Returns a JPEG copy of `file` scaled to fit MAX_EDGE, or `file` itself when
 * compressing is impossible or would not help.
 */
export async function compressImage(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file

  let bitmap: ImageBitmap
  try {
    // `from-image` applies the EXIF orientation during decode. Without it a
    // photo taken in portrait re-encodes sideways, because the canvas draws raw
    // pixels and the orientation tag is dropped by the re-encode.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file // HEIC on a non-Safari browser lands here.
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    })
    // An already-optimised image can re-encode LARGER. Keeping the original
    // then is not a fallback, it is the correct answer.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], toJpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    bitmap.close()
  }
}
