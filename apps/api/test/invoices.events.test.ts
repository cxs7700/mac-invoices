import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// Ledger integration tests: every invoice mutation records its event(s) in the
// same transaction as the write (U3). Runs against the real Postgres test DB.
const app = buildApp()
const PREFIX = 'TEST-EVT-'
let cookie: string
const createdIds: string[] = []

const body = (n: string, over: Record<string, unknown> = {}) => ({
  invoiceNumber: `${PREFIX}${n}`,
  vendorName: 'Vendor',
  description: 'Work',
  amount: 100,
  category: 'OTHER',
  invoiceDate: '2026-02-01',
  ...over,
})

async function createOwn(n: string, over: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/invoices', payload: body(n, over), headers: { cookie } })
  expect(res.statusCode).toBe(201)
  const inv = res.json()
  createdIds.push(inv.id)
  return inv as { id: string; user: { id: string } }
}

const eventsFor = (invoiceId: string) =>
  app.prisma.invoiceEvent.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } })

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
})
afterAll(async () => {
  if (createdIds.length) await app.prisma.invoiceEvent.deleteMany({ where: { invoiceId: { in: createdIds } } })
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await app.close()
})

describe('create records a CREATED event', () => {
  it('writes exactly one CREATED event attributed to the owner', async () => {
    const inv = await createOwn('create')
    const events = await eventsFor(inv.id)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('CREATED')
    expect(events[0].source).toBe('RECORDED')
    expect(events[0].actorId).toBe(inv.user.id)
    expect(events[0].ownerUserId).toBe(inv.user.id)
  })
})

describe('update records events', () => {
  it('AE1: a PENDING -> APPROVED transition records one STATUS_CHANGED {from,to}', async () => {
    const inv = await createOwn('status')
    const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: { status: 'APPROVED' }, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const events = await eventsFor(inv.id)
    const changed = events.filter((e) => e.type === 'STATUS_CHANGED')
    expect(changed).toHaveLength(1)
    expect(changed[0].detail).toEqual({ from: 'PENDING', to: 'APPROVED' })
  })

  it('AE2: an amount edit records FIELD_EDITED old->new; an untracked-field edit records nothing', async () => {
    const inv = await createOwn('amount')
    await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: { amount: 250 }, headers: { cookie } })
    let events = await eventsFor(inv.id)
    const edits = events.filter((e) => e.type === 'FIELD_EDITED')
    expect(edits).toHaveLength(1)
    expect(edits[0].detail).toEqual({ field: 'amount', old: '100.00', new: '250.00' })

    // Editing only an untracked field (notes) adds no event.
    await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: { notes: 'memo' }, headers: { cookie } })
    events = await eventsFor(inv.id)
    expect(events.filter((e) => e.type === 'FIELD_EDITED')).toHaveLength(1)
  })

  it('records one event per changed tracked field, and none for a no-op edit', async () => {
    const inv = await createOwn('multi')
    await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${inv.id}`,
      payload: { amount: 300, vendorName: 'New Vendor' },
      headers: { cookie },
    })
    let events = await eventsFor(inv.id)
    expect(events.filter((e) => e.type === 'FIELD_EDITED')).toHaveLength(2)

    // Re-submitting the same values changes nothing → no new events.
    const before = (await eventsFor(inv.id)).length
    await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${inv.id}`,
      payload: { amount: 300, vendorName: 'New Vendor' },
      headers: { cookie },
    })
    events = await eventsFor(inv.id)
    expect(events).toHaveLength(before)
  })

  it("does not record an event when patching another user's invoice (404)", async () => {
    const second = await createSecondUser(app)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/invoices', payload: body('owned-by-second'), headers: { cookie: second.cookie } })
      const otherId = created.json().id
      createdIds.push(otherId)
      const before = (await eventsFor(otherId)).length
      const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${otherId}`, payload: { status: 'PAID' }, headers: { cookie } })
      expect(res.statusCode).toBe(404)
      expect((await eventsFor(otherId)).length).toBe(before)
    } finally {
      await second.cleanup()
    }
  })
})

describe('delete writes a surviving tombstone', () => {
  it('AE3: deletion records a DELETED event whose snapshot survives the row', async () => {
    const inv = await createOwn('del', { amount: 149.99 })
    const del = await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)

    // The invoice row is gone...
    const gone = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}`, headers: { cookie } })
    expect(gone.statusCode).toBe(404)

    // ...but its DELETED event (with a precise snapshot) remains in the ledger.
    const events = await eventsFor(inv.id)
    const tomb = events.find((e) => e.type === 'DELETED')
    expect(tomb).toBeTruthy()
    const snapshot = (tomb!.detail as { snapshot: Record<string, unknown> }).snapshot
    expect(snapshot.invoiceNumber).toBe(`${PREFIX}del`)
    expect(snapshot.amount).toBe('149.99')
    expect(snapshot.status).toBe('PENDING')
  })

  it("does not record an event when deleting another user's invoice (404)", async () => {
    const second = await createSecondUser(app)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/invoices', payload: body('del-second'), headers: { cookie: second.cookie } })
      const otherId = created.json().id
      createdIds.push(otherId)
      const res = await app.inject({ method: 'DELETE', url: `/api/invoices/${otherId}`, headers: { cookie } })
      expect(res.statusCode).toBe(404)
      expect((await eventsFor(otherId)).filter((e) => e.type === 'DELETED')).toHaveLength(0)
    } finally {
      await second.cleanup()
    }
  })
})

describe('GET /api/invoices/:id/events', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices/x/events' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the events oldest-first with a resolved actor', async () => {
    const inv = await createOwn('feed')
    await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: { amount: 200 }, headers: { cookie } })
    const res = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/events`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<{ type: string; actor: { id: string; name: string | null } }>
    expect(data.map((e) => e.type)).toEqual(['CREATED', 'FIELD_EDITED'])
    expect(data[0].actor.id).toBe(inv.user.id)
    expect(data[0].actor).toHaveProperty('name')
  })

  it("returns an empty list for another user's invoice (no existence leak)", async () => {
    const second = await createSecondUser(app)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/invoices', payload: body('feed-second'), headers: { cookie: second.cookie } })
      const otherId = created.json().id
      createdIds.push(otherId)
      const res = await app.inject({ method: 'GET', url: `/api/invoices/${otherId}/events`, headers: { cookie } })
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toEqual([])
    } finally {
      await second.cleanup()
    }
  })

  it("still returns a deleted invoice's events to its owner", async () => {
    const inv = await createOwn('feed-del')
    await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}`, headers: { cookie } })
    const res = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/events`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const types = (res.json().data as Array<{ type: string }>).map((e) => e.type)
    expect(types).toContain('CREATED')
    expect(types).toContain('DELETED')
  })
})

describe('transaction atomicity', () => {
  it('rolls the event back with the mutation: a duplicate-number create writes no orphan CREATED event', async () => {
    const inv = await createOwn('dup')
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'CREATED')).toHaveLength(1)

    // Second create with the same client-supplied number fails the unique
    // constraint inside the transaction → 409, and its CREATED event must roll
    // back with it (no second invoice, no extra event).
    const dup = await app.inject({ method: 'POST', url: '/api/invoices', payload: body('dup'), headers: { cookie } })
    expect(dup.statusCode).toBe(409)
    const withNumber = await app.prisma.invoice.findMany({ where: { invoiceNumber: `${PREFIX}dup` } })
    expect(withNumber).toHaveLength(1)
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'CREATED')).toHaveLength(1)
  })
})
