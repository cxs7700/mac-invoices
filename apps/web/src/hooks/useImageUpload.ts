import { put } from '@vercel/blob/client'
import { apiClient } from '@/lib/apiClient'

// Direct browser→Blob upload. The file never goes through the JSON-only apiClient
// (or the 60s API function): apiClient only fetches a short-lived upload token,
// then the file is PUT straight to storage with that token.

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

/** Client-side guard before any upload — returns an error message, or null if ok. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Please choose a JPEG, PNG, HEIC, or WebP image.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'That image is larger than 10 MB — please use a smaller one.'
  }
  return null
}

/** Upload a photo and return its stored blob URL. `onProgress` reports 0–100. */
export async function uploadInvoicePhoto(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { token, pathname } = await apiClient<{ token: string; pathname: string }>(
    '/api/invoices/image-upload-token',
    { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
  )
  // The blob lands at exactly the server-issued pathname (the token pins it with
  // addRandomSuffix:false), so the owner-prefix gate and the orphan-blob sweep can
  // match the stored URL's pathname to what they expect.
  const result = await put(pathname, file, {
    access: 'private',
    token,
    contentType: file.type,
    onUploadProgress: onProgress ? (event) => onProgress(Math.round(event.percentage)) : undefined,
  })
  return result.url
}
