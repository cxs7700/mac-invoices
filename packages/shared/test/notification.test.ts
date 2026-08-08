import { describe, it, expect } from 'vitest'
import { NotificationItemSchema, NotificationFeedSchema } from '../src/index'

const validItem = {
  id: 'evt_1',
  type: 'CREATED',
  vendorName: 'Joe',
  invoiceId: 'inv_1',
  summary: 'submitted an invoice',
  createdAt: '2026-06-25T00:00:00.000Z',
  unread: true,
}

describe('NotificationItemSchema', () => {
  it('parses a valid item and coerces createdAt to a Date', () => {
    const result = NotificationItemSchema.safeParse(validItem)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.createdAt).toBeInstanceOf(Date)
  })

  it('accepts a null vendorName', () => {
    expect(NotificationItemSchema.safeParse({ ...validItem, vendorName: null }).success).toBe(true)
  })
})

describe('NotificationFeedSchema', () => {
  it('parses a feed envelope with data + unreadCount', () => {
    const result = NotificationFeedSchema.safeParse({ data: [validItem], unreadCount: 1 })
    expect(result.success).toBe(true)
  })
})
