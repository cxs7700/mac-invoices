import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()

async function vendor(landlordId: string, name: string) {
  return app.prisma.vendor.create({
    data: {
      landlordId,
      name,
      phone: 'x',
      tokenLookupId: `fk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tokenHash: 'h',
    },
  })
}
const ev = (ownerUserId: string, vendorId: string, type: string, detail: object = {}) =>
  app.prisma.invoiceEvent.create({
    data: {
      invoiceId: `inv-${Math.random().toString(36).slice(2)}`,
      actorId: `vendor:${vendorId}`,
      ownerUserId,
      type: type as never,
      detail,
    },
  })

const get = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie } })
const seen = (cookie: string) =>
  app.inject({ method: 'POST', url: '/api/notifications/seen', headers: { cookie } })

beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close() })

describe('GET /api/notifications', () => {
  it('401s without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401)
  })

  it('returns the landlord-scoped feed, newest-first, with resolved names + summaries', async () => {
    const { user, cookie, cleanup } = await createSecondUser(app)
    // A different landlord's activity must never leak into this feed.
    const other = await createSecondUser(app)
    try {
      const c = await vendor(user.id, 'Joe')
      const oc = await vendor(other.user.id, 'Eve')
      await ev(user.id, c.id, 'CREATED')
      await ev(user.id, c.id, 'FIELD_EDITED', { field: 'amount', old: '1', new: '2' })
      await ev(user.id, c.id, 'STATUS_CHANGED', { from: 'SUBMITTED', to: 'CANCELLED' })
      await ev(other.user.id, oc.id, 'CREATED') // other landlord — must not appear

      const res = await get(cookie)
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toHaveLength(3)
      // Scoped: every item is one of this landlord's vendors.
      expect(body.data.every((i: { vendorName: string }) => i.vendorName === 'Joe')).toBe(true)
      // Newest-first ordering.
      const ts = body.data.map((i: { createdAt: string }) => new Date(i.createdAt).getTime())
      expect([...ts].sort((a, b) => b - a)).toEqual(ts)
      // Summaries cover submit / edit / withdraw.
      const summaries = body.data.map((i: { summary: string }) => i.summary)
      expect(summaries).toContain('submitted an invoice')
      expect(summaries).toContain('edited a submission')
      expect(summaries).toContain('withdrew a submission')
    } finally {
      await app.prisma.invoiceEvent.deleteMany({ where: { ownerUserId: { in: [user.id, other.user.id] } } })
      await cleanup()
      await other.cleanup()
    }
  })

  it('counts unread vs seen, and POST /seen clears the count', async () => {
    const { user, cookie, cleanup } = await createSecondUser(app)
    try {
      const c = await vendor(user.id, 'Pat')
      await ev(user.id, c.id, 'CREATED')
      await ev(user.id, c.id, 'CREATED')

      // No seen marker yet → everything unread.
      let body = (await get(cookie)).json()
      expect(body.unreadCount).toBe(2)
      expect(body.data.every((i: { unread: boolean }) => i.unread)).toBe(true)

      // Mark seen.
      const seenRes = await seen(cookie)
      expect(seenRes.statusCode).toBe(200)

      body = (await get(cookie)).json()
      expect(body.unreadCount).toBe(0)
      expect(body.data.every((i: { unread: boolean }) => !i.unread)).toBe(true)

      // A new event after the marker is unread again.
      await ev(user.id, c.id, 'STATUS_CHANGED', { to: 'CANCELLED' })
      body = (await get(cookie)).json()
      expect(body.unreadCount).toBe(1)
      expect(body.data.find((i: { unread: boolean }) => i.unread)?.summary).toBe('withdrew a submission')
    } finally {
      await app.prisma.invoiceEvent.deleteMany({ where: { ownerUserId: user.id } })
      await cleanup()
    }
  })
})
