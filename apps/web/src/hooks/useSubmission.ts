import { put } from '@vercel/blob/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SubmissionStatus, ImageType } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'
import { compressImage } from '@/lib/compressImage'

// Public (no-session) hooks for the vendor link page. Authorization is the
// path token alone; apiClient still sends credentials but there is no cookie.

const base = (token: string) => `/api/submissions/${encodeURIComponent(token)}`

/** Token-scoped photo upload — mints a client token from the PUBLIC endpoint. */
export async function uploadSubmissionPhoto(
  token: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // Compress BEFORE minting the token — it is pinned to one allowed content
  // type, so a token minted for the original HEIC rejects the JPEG this makes.
  // This is the path that matters most: the vendor is on field LTE, and the
  // photo is the largest thing the flow moves.
  const upload = await compressImage(file)
  const { token: clientToken, pathname } = await apiClient<{ token: string; pathname: string }>(
    `${base(token)}/upload-token`,
    { method: 'POST', body: JSON.stringify({ contentType: upload.type }) },
  )
  // Lands at exactly the server-issued pathname (token pins addRandomSuffix:false)
  // so the owner-prefix gate and the orphan-blob sweep match on pathname.
  const result = await put(pathname, upload, {
    access: 'private',
    token: clientToken,
    contentType: upload.type,
    onUploadProgress: onProgress ? (e) => onProgress(Math.round(e.percentage)) : undefined,
  })
  return result.url
}

/**
 * The vendor's own submissions + statuses. This query doubles as the token
 * validity check: a 404 ApiError means the link is no longer active.
 */
export function useSubmissionStatus(token: string) {
  return useQuery<{ data: SubmissionStatus[] }>({
    queryKey: ['submissions', token],
    queryFn: () => apiClient(`${base(token)}`),
    retry: false,
  })
}

export type SubmissionProperty = { id: string; name: string; address: string }

/** The properties assigned to THIS vendor, so they can file against one.
 * Scoped to the assignment, not the landlord's whole portfolio; an empty array
 * is a normal result and the page renders a "contact your landlord" panel.
 * Disclosed to link holders by design — see the handler's note. */
export function useSubmissionProperties(token: string) {
  return useQuery<{ data: SubmissionProperty[] }>({
    queryKey: ['submission-properties', token],
    queryFn: () => apiClient(`${base(token)}/properties`),
    retry: false,
  })
}

export type SubmitBody = {
  // Itemized like the landlord form; the server sums the totals into `amount`.
  items: { description: string; quantity: number; total: number }[]
  invoiceDate: string
  notes?: string
  partsOrdered?: string
  // All optional: the landlord can set or change either on review.
  category?: string
  propertyId?: string
  // Optional as of 2026-08-09 — a vendor may submit without a photo.
  images?: { url: string; type: ImageType }[]
}

export function useSubmit(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SubmitBody) =>
      apiClient(`${base(token)}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submissions', token] }),
  })
}

export function useWithdraw(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient(`${base(token)}/${id}/withdraw`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submissions', token] }),
  })
}
