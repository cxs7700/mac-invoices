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

// A vendor-withdrawn submission is CANCELLED and terminal, but it must not
// clutter the landlord's working table: it disappears from the list and the
// status counts entirely. The row itself survives (the "vendor withdrew"
// notification links to it), and the landlord's OWN cancelled invoices are
// unaffected.
const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>
const cookie = () => landlord.cookie
const tokenOf = (link: string) => link.split('/submit/')[1]

async function makeVendor() {
  const name = `Withdraw Test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const r = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    payload: { name, phone: 'x' },
    headers: { cookie: cookie() },
  })
  return { id: r.json().id as string, token: tokenOf(r.json().link) }
}

async function submitAndWithdraw() {
  const v = await makeVendor()
  const created = await app.inject({
    method: 'POST',
    url: `/api/submissions/${v.token}`,
    payload: {
      items: [{ description: 'work', quantity: 1, total: 100 }],
      invoiceDate: '2026-06-01',
      images: [{ url: `https://blob/owners/c_${v.id}/p.jpg`, type: 'OTHER' }],
    },
  })
  expect(created.statusCode).toBe(201)
  const id = created.json().id as string
  const withdrawn = await app.inject({
    method: 'POST',
    url: `/api/submissions/${v.token}/${id}/withdraw`,
  })
  expect(withdrawn.statusCode).toBe(200)
  expect(withdrawn.json().status).toBe('CANCELLED')
  return id
}

const list = (query = '') =>
  app.inject({ method: 'GET', url: `/api/invoices${query}`, headers: { cookie: cookie() } })

beforeAll(async () => {
  await app.ready()
  landlord = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('withdrawn submissions are hidden from the landlord', () => {
  it('a withdrawn submission does not appear in GET /api/invoices', async () => {
    const id = await submitAndWithdraw()
    const res = await list()
    expect(res.statusCode).toBe(200)
    const ids = res.json().data.map((i: { id: string }) => i.id)
    expect(ids).not.toContain(id)
    expect(res.json().pagination.total).toBe(0)
  })

  it('a withdrawn submission does not appear even under status=CANCELLED', async () => {
    const id = await submitAndWithdraw()
    const res = await list('?status=CANCELLED')
    const ids = res.json().data.map((i: { id: string }) => i.id)
    expect(ids).not.toContain(id)
  })

  it('a withdrawn submission is not counted in GET /api/invoices/stats', async () => {
    await submitAndWithdraw()
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices/stats',
      headers: { cookie: cookie() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().counts.CANCELLED).toBe(0)
  })

  it("the landlord's own CANCELLED invoice still appears in the list and stats", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: { cookie: cookie() },
      payload: {
        invoiceNumber: `WD-OWN-${Date.now()}`,
        vendorName: 'Own Cancelled Vendor',
        items: [{ description: 'Work', quantity: 1, total: 50 }],
        category: 'OTHER',
        invoiceDate: '2026-06-02',
      },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().id as string
    const cancelled = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${id}`,
      headers: { cookie: cookie() },
      payload: { status: 'CANCELLED' },
    })
    expect(cancelled.statusCode).toBe(200)

    const res = await list('?status=CANCELLED')
    const ids = res.json().data.map((i: { id: string }) => i.id)
    expect(ids).toContain(id)

    const stats = await app.inject({
      method: 'GET',
      url: '/api/invoices/stats',
      headers: { cookie: cookie() },
    })
    expect(stats.json().counts.CANCELLED).toBe(1)
  })

  it('a withdrawn submission stays reachable by id (notification link)', async () => {
    const id = await submitAndWithdraw()
    const res = await app.inject({
      method: 'GET',
      url: `/api/invoices/${id}`,
      headers: { cookie: cookie() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('CANCELLED')
  })
})
