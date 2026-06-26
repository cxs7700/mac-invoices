import { randomUUID } from 'node:crypto'
import { del, getDownloadUrl, list } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { AppError } from '../middleware/errorHandler'

// Object storage for invoice photos (Vercel Blob). The handler imports this
// module directly; tests `vi.mock` it. The file is uploaded browser→Blob
// directly via a short-lived client token — it never streams through the API
// function (Vercel's 60s limit). Provider errors are NEVER propagated raw — the
// central error handler logs whatever is thrown, and a raw error could embed the
// BLOB_READ_WRITE_TOKEN.

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
const UPLOAD_TOKEN_TTL_MS = 5 * 60 * 1000 // 5 min to complete the upload

/** Read the Blob token, distinguishing unset (not configured) from present. */
function readWriteToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new AppError('STORAGE_NOT_CONFIGURED', 'Image storage is not configured', 503)
  }
  return token
}

/** Reduce a blob URL or pathname to its pathname (strip origin + query). */
export function toPathname(urlOrPathname: string): string {
  try {
    return new URL(urlOrPathname).pathname.replace(/^\/+/, '')
  } catch {
    return urlOrPathname.replace(/^\/+/, '')
  }
}

/** The owner segment of an `owners/<ownerId>/…` blob ref, or null if it doesn't match. */
export function ownerOf(urlOrPathname: string): string | null {
  const match = /^owners\/([^/]+)\//.exec(toPathname(urlOrPathname))
  return match ? match[1] : null
}

/** KTD-5 gate: is this blob ref owned by `ownerId`? */
export function isOwnedBy(urlOrPathname: string, ownerId: string): boolean {
  return ownerOf(urlOrPathname) === ownerId
}

/** Map a provider error to a safe AppError — never leak the raw error / token. */
function sanitize(err: unknown): AppError {
  if (err instanceof AppError) return err
  return new AppError('STORAGE_ERROR', 'Image storage request failed', 502)
}

/**
 * Issue a short-lived client upload token scoped to a unique pathname under the
 * owner's prefix, constrained to image content types and a max size. The client
 * uploads directly to Blob with this token; the returned pathname is what the
 * caller later attaches to an invoice (and is re-validated by owner prefix).
 */
export async function issueUploadToken(
  ownerId: string,
  contentType: string,
): Promise<{ token: string; pathname: string }> {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Only JPEG, PNG, HEIC, or WebP images are accepted',
      415,
    )
  }
  const pathname = `owners/${ownerId}/${randomUUID()}`
  try {
    const token = await generateClientTokenFromReadWriteToken({
      token: readWriteToken(),
      pathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
    })
    return { token, pathname }
  } catch (err) {
    throw sanitize(err)
  }
}

/**
 * A read URL for an owned blob. Blobs are private; `getDownloadUrl` returns the
 * store's signed, expiring download URL. (Go-live: confirm the store's signed-URL
 * TTL is short — ~15 min — and that private access is enabled.)
 */
export function signedReadUrl(urlOrPathname: string): string {
  readWriteToken() // ensure configured (throws 503 otherwise)
  try {
    return getDownloadUrl(urlOrPathname)
  } catch (err) {
    throw sanitize(err)
  }
}

/** Delete a blob (best-effort on replace/remove/invoice-delete). */
export async function deleteBlob(urlOrPathname: string): Promise<void> {
  try {
    await del(urlOrPathname, { token: readWriteToken() })
  } catch (err) {
    throw sanitize(err)
  }
}

/** One stored blob, as the orphan sweep needs it. */
export type StoredBlob = { url: string; pathname: string; uploadedAt: Date }

/**
 * Every blob under `prefix` (paginated). Used by the orphan-blob sweep to find
 * uploads that were never attached to an invoice. Read-only; the caller decides
 * what to reclaim.
 */
export async function listAllBlobs(prefix = 'owners/'): Promise<StoredBlob[]> {
  const token = readWriteToken()
  const out: StoredBlob[] = []
  let cursor: string | undefined
  try {
    do {
      const page = await list({ token, prefix, cursor, limit: 1000 })
      for (const b of page.blobs) {
        out.push({ url: b.url, pathname: b.pathname, uploadedAt: b.uploadedAt })
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
  } catch (err) {
    throw sanitize(err)
  }
  return out
}
