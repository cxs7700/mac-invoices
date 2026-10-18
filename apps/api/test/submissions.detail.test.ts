import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  ownerOf: (url: string) =>
    /^owners\/([^/]+)\//.exec(url.replace(/^https?:\/\/[^/]+\//, ''))?.[1] ?? null,
  isOwnedBy: (url: string, owner: string) =>
    url.replace(/^https?:\/\/[^/]+\//, '').startsWith(`owners/${owner}/`),
  deleteBlob: vi.fn(async () => {}),
  issueUploadToken: vi.fn(async (o: string) => ({ token: 't', pathname: `owners/${o}/p` })),
  signedReadUrl: vi.fn(() => 'https://signed/url'),
}))
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>
let propId: string // required-on-approval: the landlord assigns this when approving
const tokenOf = (link: string) => link.split('/submit/')[1]

// Name defaults to a fresh unique value per call: vendor names are now
// unique per landlord (case-insensitively — migration 20260807200000), and
// this file creates several vendors under the one shared landlord.
async function makeVendor(name = `Joe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    payload: { name, phone: 'x' },
    headers: { cookie: landlord.cookie },
  })
  return { id: r.json().id, token: tokenOf(r.json().link) }
}

async function submit(vendorId: string, token: string, over: Record<string, unknown> = {}) {
  const r = await app.inject({
    method: 'POST',
    url: `/api/submissions/${token}`,
    payload: {
      items: [{ description: 'work', quantity: 1, total: 100 }],
      invoiceDate: '2026-06-01',
      images: [{ url: `https://blob/owners/c_${vendorId}/p.jpg`, type: 'OTHER' }],
      ...over,
    },
  })
  return r.json().id as string
}

const approve = (id: string) =>
  app.inject({
    method: 'PATCH',
    url: `/api/invoices/${id}`,
    payload: { status: 'APPROVED', category: 'LABOR', propertyId: propId },
    headers: { cookie: landlord.cookie },
  })

beforeAll(async () => {
  await app.ready()
  landlord = await createSecondUser(app)
  propId = (
    await app.prisma.property.create({
      data: { landlordId: landlord.user.id, name: 'P', address: 'A' },
    })
  ).id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('vendor submission detail (read-only)', () => {
  const detail = (token: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/submissions/${token}/${id}` })

  it('returns the full submission: lines, notes, photos with signed URLs', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token, {
      items: [
        { description: 'Labour', quantity: 2, total: 150 },
        { description: 'Parts', quantity: 1, total: 25.5 },
      ],
      notes: 'Back door',
      partsOrdered: 'Washer kit',
      propertyId: undefined,
    })
    const res = await detail(c.token, id)
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.status).toBe('SUBMITTED')
    expect(d.amount).toBe('175.50')
    expect(d.items).toEqual([
      { description: 'Labour', quantity: 2, total: '150.00' },
      { description: 'Parts', quantity: 1, total: '25.50' },
    ])
    expect(d.notes).toBe('Back door')
    expect(d.partsOrdered).toBe('Washer kit')
    expect(d.images).toHaveLength(1)
    expect(d.images[0].url).toBe('https://signed/url') // freshly signed, not the raw blob path
    // No invoiceNumber in the vendor-facing shape.
    expect(Object.keys(d)).not.toContain('invoiceNumber')
  })

  it('another vendor\u2019s id (or a guess) is a uniform 404', async () => {
    const a = await makeVendor()
    const b = await makeVendor()
    const id = await submit(a.id, a.token)
    expect((await detail(b.token, id)).statusCode).toBe(404)
    expect((await detail(a.token, 'no-such-id')).statusCode).toBe(404)
  })

  it('submissions can no longer be edited: the PATCH route is gone', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/submissions/${c.token}/${id}`,
      payload: { items: [{ description: 'work', quantity: 1, total: 999 }] },
    })
    expect(res.statusCode).toBe(404)
    const row = await app.prisma.invoice.findUniqueOrThrow({ where: { id } })
    expect(Number(row.amount)).toBe(100) // untouched
  })

  it('summarizes every line in the vendor\u2019s own status list, not just the first', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token, {
      items: [
        { description: 'Labour', quantity: 1, total: 100 },
        { description: 'Valve', quantity: 1, total: 20 },
      ],
    })
    const list = (await app.inject({ method: 'GET', url: `/api/submissions/${c.token}` })).json()
      .data
    const row = list.find((r: { id: string }) => r.id === id)
    expect(row.description).toBe('Labour, Valve')
  })

  it('own-status list returns this vendor\u2019s submissions with rejection reason', async () => {
    const c = await makeVendor()
    const ok = await submit(c.id, c.token)
    const rejectMe = await submit(c.id, c.token)
    await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${rejectMe}`,
      payload: { status: 'REJECTED', rejectionReason: 'Wrong amount' },
      headers: { cookie: landlord.cookie },
    })
    const list = (await app.inject({ method: 'GET', url: `/api/submissions/${c.token}` })).json()
      .data
    expect(list).toHaveLength(2)
    const rejected = list.find((r: { id: string }) => r.id === rejectMe)
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.rejectionReason).toBe('Wrong amount')
    const submitted = list.find((r: { id: string }) => r.id === ok)
    expect(submitted.status).toBe('SUBMITTED')
    // No invoiceNumber leaked in the safe shape.
    expect(Object.keys(rejected)).not.toContain('invoiceNumber')
  })
})

describe('vendor withdraw (U8)', () => {
  const withdraw = (token: string, id: string) =>
    app.inject({ method: 'POST', url: `/api/submissions/${token}/${id}/withdraw` })

  it('withdraws a SUBMITTED submission → CANCELLED; row + photo survive', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const res = await withdraw(c.token, id)
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('CANCELLED')
    const row = await app.prisma.invoice.findUnique({ where: { id } })
    expect(row).not.toBeNull() // landlord-owned row survives
    const ev = await app.prisma.invoiceEvent.findFirstOrThrow({
      where: { invoiceId: id, type: 'STATUS_CHANGED' },
    })
    expect(ev.actorId).toBe(`vendor:${c.id}`)
    const img = await app.prisma.invoiceImage.count({ where: { invoiceId: id } })
    expect(img).toBe(1) // photo retained
  })

  it('withdraw on an already-reviewed submission is a 409', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    await approve(id)
    expect((await withdraw(c.token, id)).statusCode).toBe(409)
  })

  it('concurrent withdraw vs landlord approve resolves to exactly one terminal state', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const [w, a] = await Promise.all([withdraw(c.token, id), approve(id)])
    // Exactly one wins: the other gets a 409 (withdraw) or 422 (approve race).
    const row = await app.prisma.invoice.findUniqueOrThrow({ where: { id } })
    expect(['CANCELLED', 'APPROVED']).toContain(row.status)
    const winners = [w.statusCode === 200, a.statusCode === 200].filter(Boolean).length
    expect(winners).toBe(1) // single-winner: no double-commit
    // The ledger has exactly one terminal STATUS_CHANGED out of SUBMITTED.
    const transitions = await app.prisma.invoiceEvent.count({
      where: { invoiceId: id, type: 'STATUS_CHANGED' },
    })
    expect(transitions).toBe(1)
  })
})
