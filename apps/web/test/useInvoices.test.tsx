import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useInvoices } from '@/hooks/useInvoices'
import { useInvoiceStats } from '@/hooks/useInvoiceStats'

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useInvoices querystring assembly', () => {
  it('includes every provided filter/sort param and omits absent ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [], pagination: { total: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(
      () =>
        useInvoices({
          status: 'PAID',
          from: '2026-01-01',
          to: '2026-03-31',
          vendor: 'acme',
          sort: 'amount',
          order: 'asc',
          limit: 20,
          offset: 20,
        }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    for (const part of [
      'status=PAID',
      'from=2026-01-01',
      'to=2026-03-31',
      'vendor=acme',
      'sort=amount',
      'order=asc',
      'limit=20',
      'offset=20',
    ]) {
      expect(url).toContain(part)
    }
  })

  it('omits filter params that are not set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ data: [], pagination: { total: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useInvoices({}), { wrapper: wrapper() })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).not.toContain('status=')
    expect(url).not.toContain('vendor=')
    expect(url).toContain('limit=')
    expect(url).toContain('offset=')
  })
})

describe('useInvoiceStats', () => {
  it('fetches the stats endpoint and surfaces counts/total', async () => {
    const body = { counts: { PENDING: 2, APPROVED: 0, PAID: 1, REJECTED: 0, CANCELLED: 0 }, total: 3 }
    const fetchMock = vi.fn().mockResolvedValue(ok(body))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useInvoiceStats(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/invoices/stats')
    expect(result.current.data?.total).toBe(3)
    expect(result.current.data?.counts.PENDING).toBe(2)
  })
})
