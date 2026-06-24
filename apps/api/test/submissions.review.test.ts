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

// U9 — landlord review surface: number assigned on approval, contractor name
// resolved in the timeline + detail, the SUBMITTED queue + count.
const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>
const cookie = () => landlord.cookie
const tokenOf = (link: string) => link.split('/submit/')[1]

async function makeContractor(name = 'Joe Plumber') {
  const r = await app.inject({
    method: 'POST',
    url: '/api/contractors',
    payload: { name, contact: 'x' },
    headers: { cookie: cookie() },
  })
  return { id: r.json().id, token: tokenOf(r.json().link), name }
}
async function submit(contractorId: string, token: string) {
  const r = await app.inject({
    method: 'POST',
    url: `/api/submissions/${token}`,
    payload: {
      amount: 100,
      description: 'work',
      invoiceDate: '2026-06-01',
      image: { url: `https://blob/owners/c_${contractorId}/p.jpg`, type: 'OTHER' },
    },
  })
  return r.json().id as string
}
const patch = (id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/api/invoices/${id}`, payload, headers: { cookie: cookie() } })

beforeAll(async () => {
  await app.ready()
  landlord = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('U9 landlord review', () => {
  it('assigns an invoice number on the first APPROVED (KTD-11)', async () => {
    const c = await makeContractor()
    const id = await submit(c.id, c.token)
    expect((await app.prisma.invoice.findUniqueOrThrow({ where: { id } })).invoiceNumber).toBeNull()
    const res = await patch(id, { status: 'APPROVED', category: 'LABOR' })
    expect(res.statusCode).toBe(200)
    expect(res.json().invoiceNumber).not.toBeNull()
  })

  it('a withdrawn or rejected submission never consumes a number (no ledger gap)', async () => {
    const c = await makeContractor()
    const rejected = await submit(c.id, c.token)
    await patch(rejected, { status: 'REJECTED', rejectionReason: 'no' })
    const withdrawn = await submit(c.id, c.token)
    await app.inject({ method: 'POST', url: `/api/submissions/${c.token}/${withdrawn}/withdraw` })
    expect((await app.prisma.invoice.findUniqueOrThrow({ where: { id: rejected } })).invoiceNumber).toBeNull()
    expect((await app.prisma.invoice.findUniqueOrThrow({ where: { id: withdrawn } })).invoiceNumber).toBeNull()
  })

  it('resolves the contractor name in the timeline (not null) and on the detail', async () => {
    const c = await makeContractor('Pat Contractor')
    const id = await submit(c.id, c.token)
    const events = (await app.inject({ method: 'GET', url: `/api/invoices/${id}/events`, headers: { cookie: cookie() } })).json().data
    const created = events.find((e: { type: string }) => e.type === 'CREATED')
    expect(created.actor.id).toBe(`contractor:${c.id}`)
    expect(created.actor.name).toBe('Pat Contractor') // resolved, not null
    const detail = (await app.inject({ method: 'GET', url: `/api/invoices/${id}`, headers: { cookie: cookie() } })).json()
    expect(detail.submitterName).toBe('Pat Contractor')
  })

  it('serves the SUBMITTED queue + count to the landlord', async () => {
    const c = await makeContractor()
    const id = await submit(c.id, c.token)
    const queue = (await app.inject({ method: 'GET', url: '/api/invoices?status=SUBMITTED', headers: { cookie: cookie() } })).json()
    expect(queue.data.map((i: { id: string }) => i.id)).toContain(id)
    const stats = (await app.inject({ method: 'GET', url: '/api/invoices/stats', headers: { cookie: cookie() } })).json()
    expect(stats.counts.SUBMITTED).toBeGreaterThan(0)
  })
})
