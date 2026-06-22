import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient, ApiError } from '@/lib/apiClient'

type Headers = Record<string, string>

function fakeResponse(
  status: number,
  body: unknown,
  headers: Headers = { 'content-type': 'application/json' },
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('apiClient', () => {
  it('requests same-origin (relative) when VITE_API_URL is unset, and sends credentials', async () => {
    // No VITE_API_URL in the test env → empty base → relative same-origin path,
    // matching the production Vercel deploy.
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { status: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('/api/health')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init.credentials).toBe('include')
  })

  it('returns parsed JSON on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200, { status: 'ok' })))
    await expect(apiClient('/api/health')).resolves.toEqual({ status: 'ok' })
  })

  it('returns undefined on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(204, '')))
    await expect(apiClient('/api/invoices/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('throws ApiError exposing code + message on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          fakeResponse(404, { error: { code: 'NOT_FOUND', message: 'Invoice not found' } }),
        ),
    )
    await expect(apiClient('/api/invoices/999')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Invoice not found',
      status: 404,
    })
    await expect(apiClient('/api/invoices/999')).rejects.toBeInstanceOf(ApiError)
  })

  it('propagates network rejections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(apiClient('/api/health')).rejects.toThrow('network down')
  })

  it('keeps Content-Type + credentials when the caller passes custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient('/api/invoices', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: '{}',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer t')
  })

  it('throws a clean ApiError when a JSON response has a malformed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: { get: () => 'application/json' },
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input')
        },
        text: async () => '',
      }),
    )
    await expect(apiClient('/api/health')).rejects.toMatchObject({ code: 'ERROR', status: 502 })
    await expect(apiClient('/api/health')).rejects.toBeInstanceOf(ApiError)
  })
})
