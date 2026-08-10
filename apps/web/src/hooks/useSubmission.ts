import { put } from '@vercel/blob/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SubmissionStatus, ImageType } from '@mac-invoices/shared'
import { apiClient } from '@/lib/apiClient'

// Public (no-session) hooks for the vendor link page. Authorization is the
// path token alone; apiClient still sends credentials but there is no cookie.

const base = (token: string) => `/api/submissions/${encodeURIComponent(token)}`

/** Token-scoped photo upload — mints a client token from the PUBLIC endpoint. */
export async function uploadSubmissionPhoto(
  token: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const { token: clientToken, pathname } = await apiClient<{ token: string; pathname: string }>(
    `${base(token)}/upload-token`,
    { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
  )
  // Lands at exactly the server-issued pathname (token pins addRandomSuffix:false)
  // so the owner-prefix gate and the orphan-blob sweep match on pathname.
  const result = await put(pathname, file, {
    access: 'private',
    token: clientToken,
    contentType: file.type,
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

export type SubmitBody = {
  // Itemized like the landlord form; the server sums the totals into `amount`.
  items: { description: string; quantity: number; total: number }[]
  invoiceDate: string
  notes?: string
  partsOrdered?: string
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
