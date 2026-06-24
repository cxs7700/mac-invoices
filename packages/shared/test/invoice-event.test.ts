import { describe, it, expect } from 'vitest'
import { InvoiceEventSchema, InvoiceEventsResponseSchema } from '../src/index'

const validEvent = {
  id: 'evt_1',
  invoiceId: 'inv_1',
  type: 'STATUS_CHANGED',
  source: 'RECORDED',
  detail: { from: 'PENDING', to: 'APPROVED' },
  actor: { id: 'user_1', name: 'Landlord' },
  createdAt: '2026-06-23T00:00:00.000Z',
}

describe('InvoiceEventSchema', () => {
  it('parses a valid event and coerces createdAt to a Date', () => {
    const result = InvoiceEventSchema.safeParse(validEvent)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.createdAt).toBeInstanceOf(Date)
  })

  it('accepts a null actor name', () => {
    expect(InvoiceEventSchema.safeParse({ ...validEvent, actor: { id: 'u', name: null } }).success).toBe(
      true,
    )
  })

  it('rejects an unknown event type', () => {
    expect(InvoiceEventSchema.safeParse({ ...validEvent, type: 'VIEWED' }).success).toBe(false)
  })

  it('keeps detail open (any record shape is accepted)', () => {
    const deleted = { ...validEvent, type: 'DELETED', detail: { snapshot: { amount: '149.99' } } }
    expect(InvoiceEventSchema.safeParse(deleted).success).toBe(true)
  })
})

describe('InvoiceEventsResponseSchema', () => {
  it('accepts an empty event list', () => {
    expect(InvoiceEventsResponseSchema.safeParse({ data: [] }).success).toBe(true)
  })
})
