const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/** Error thrown for non-2xx responses, carrying the API's §7 error code. */
export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Thin fetch wrapper for the API. Sends cookies (credentials: 'include'),
 * prefixes VITE_API_URL, parses JSON, and throws ApiError on non-2xx surfacing
 * the server's { error: { code, message } } shape. Pair with TanStack Query.
 */
export async function apiClient<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (res.status === 204) {
    return undefined as T
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json() : await res.text()

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(
      err?.code ?? 'ERROR',
      err?.message ?? `Request failed with ${res.status}`,
      res.status,
      err?.details,
    )
  }

  return payload as T
}
