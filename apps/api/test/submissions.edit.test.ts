import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  ownerOf: (url: string) => /^owners\/([^/]+)\//.exec(url.replace(/^https?:\/\/[^/]+\//, ''))?.[1] ?? null,
  isOwnedBy: (url: string, owner: string) => url.replace(/^https?:\/\/[^/]+\//, '').startsWith(`owners/${owner}/`),
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

async function makeVendor(name = 'Joe') {
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
      amount: 100,
      description: 'work',
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
  propId = (await app.prisma.property.create({ data: { landlordId: landlord.user.id, name: 'P', address: 'A' } })).id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('vendor edit (U7)', () => {
  it('edits a SUBMITTED submission, then locks once the landlord has approved (AE2)', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/submissions/${c.token}/${id}`,
      payload: { amount: 250 },
    })
    expect(edited.statusCode).toBe(200)
    const row = await app.prisma.invoice.findUniqueOrThrow({ where: { id } })
    expect(Number(row.amount)).toBe(250)

    // FIELD_EDITED is attributed to the vendor.
    const ev = await app.prisma.invoiceEvent.findFirstOrThrow({ where: { invoiceId: id, type: 'FIELD_EDITED' } })
    expect(ev.actorId).toBe(`vendor:${c.id}`)

    // After approval the submission is locked: the same edit is a 409.
    expect((await approve(id)).statusCode).toBe(200)
    const afterReview = await app.inject({
      method: 'PATCH',
      url: `/api/submissions/${c.token}/${id}`,
      payload: { amount: 999 },
    })
    expect(afterReview.statusCode).toBe(409)
  })

  it('editing only the description records a FIELD_EDITED event and updates the item', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/submissions/${c.token}/${id}`,
      payload: { description: 'Replaced the whole panel' },
    })
    expect(edited.statusCode).toBe(200)

    const item = await app.prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: id } })
    expect(item.description).toBe('Replaced the whole panel')

    const ev = await app.prisma.invoiceEvent.findFirstOrThrow({
      where: { invoiceId: id, type: 'FIELD_EDITED' },
    })
    expect(ev.actorId).toBe(`vendor:${c.id}`)
    expect(ev.detail).toEqual({ field: 'description', old: 'work', new: 'Replaced the whole panel' })

    // A no-op re-submit of the same description records nothing new.
    const before = await app.prisma.invoiceEvent.count({ where: { invoiceId: id } })
    await app.inject({
      method: 'PATCH',
      url: `/api/submissions/${c.token}/${id}`,
      payload: { description: 'Replaced the whole panel' },
    })
    expect(await app.prisma.invoiceEvent.count({ where: { invoiceId: id } })).toBe(before)
  })

  it('own-status list returns this vendor’s submissions with rejection reason', async () => {
    const c = await makeVendor()
    const ok = await submit(c.id, c.token)
    const rejectMe = await submit(c.id, c.token)
    await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${rejectMe}`,
      payload: { status: 'REJECTED', rejectionReason: 'Wrong amount' },
      headers: { cookie: landlord.cookie },
    })
    const list = (await app.inject({ method: 'GET', url: `/api/submissions/${c.token}` })).json().data
    expect(list).toHaveLength(2)
    const rejected = list.find((r: { id: string }) => r.id === rejectMe)
    expect(rejected.status).toBe('REJECTED')
    expect(rejected.rejectionReason).toBe('Wrong amount')
    const submitted = list.find((r: { id: string }) => r.id === ok)
    expect(submitted.status).toBe('SUBMITTED')
    // No invoiceNumber leaked in the safe shape.
    expect(Object.keys(rejected)).not.toContain('invoiceNumber')
  })

  it('two concurrent vendor edits both pass the CAS (last-write-wins, v1)', async () => {
    const c = await makeVendor()
    const id = await submit(c.id, c.token)
    const [a, b] = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/submissions/${c.token}/${id}`, payload: { amount: 200 } }),
      app.inject({ method: 'PATCH', url: `/api/submissions/${c.token}/${id}`, payload: { amount: 300 } }),
    ])
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    const row = await app.prisma.invoice.findUniqueOrThrow({ where: { id } })
    expect([200, 300]).toContain(Number(row.amount))
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
