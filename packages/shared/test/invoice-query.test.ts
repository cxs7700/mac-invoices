import { describe, it, expect } from 'vitest'
import { ListInvoicesQuerySchema } from '../src/schemas/invoice'

describe('ListInvoicesQuerySchema', () => {
  it('parses a full valid query', () => {
    const r = ListInvoicesQuerySchema.safeParse({
      status: 'PAID',
      from: '2026-01-01',
      to: '2026-03-31',
      vendor: 'acme',
      sort: 'amount',
      order: 'asc',
      limit: '25',
      offset: '50',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.from).toBeInstanceOf(Date)
      expect(r.data.limit).toBe(25)
      expect(r.data.offset).toBe(50)
      expect(r.data.sort).toBe('amount')
    }
  })

  it('applies defaults when sort/order/limit/offset are omitted', () => {
    const r = ListInvoicesQuerySchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toMatchObject({ sort: 'invoiceDate', order: 'desc', limit: 50, offset: 0 })
      expect(r.data.status).toBeUndefined()
    }
  })

  it('rejects out-of-range pagination bounds', () => {
    expect(ListInvoicesQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(ListInvoicesQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(ListInvoicesQuerySchema.safeParse({ offset: '-1' }).success).toBe(false)
    expect(ListInvoicesQuerySchema.safeParse({ offset: '100001' }).success).toBe(false)
  })

  it('rejects a non-whitelisted sort field or bad order', () => {
    expect(ListInvoicesQuerySchema.safeParse({ sort: 'vendorName' }).success).toBe(false)
    expect(ListInvoicesQuerySchema.safeParse({ order: 'sideways' }).success).toBe(false)
  })

  it('rejects an unparseable date', () => {
    expect(ListInvoicesQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false)
  })
})
