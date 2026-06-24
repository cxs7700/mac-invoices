import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Mock the storage adapter — the contractor blob-prefix gate is what we test, no
// live Blob. isOwnedBy mirrors the real owner-prefix parsing.
const storage = vi.hoisted(() => {
  const path = (u: string) => {
    try {
      return new URL(u).pathname.replace(/^\/+/, '')
    } catch {
      return u.replace(/^\/+/, '')
    }
  }
  return {
    ownerOf: (url: string) => /^owners\/([^/]+)\//.exec(path(url))?.[1] ?? null,
    isOwnedBy: (url: string, owner: string) => path(url).startsWith(`owners/${owner}/`),
    deleteBlob: vi.fn(async () => {}),
    issueUploadToken: vi.fn(async (ownerId: string) => ({ token: 'client-token', pathname: `owners/${ownerId}/p` })),
    signedReadUrl: vi.fn(() => 'https://signed/url'),
  }
})
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>

const tokenOf = (link: string) => link.split('/submit/')[1]

/** Create a contractor (as the landlord) and return { id, token, blobOwner }. */
async function makeContractor(name = 'Joe') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/contractors',
    payload: { name, contact: 'x' },
    headers: { cookie: landlord.cookie },
  })
  const body = res.json()
  return { id: body.id, token: tokenOf(body.link), blobOwner: `c_${body.id}` }
}

const submitBody = (over: Record<string, unknown> = {}, blobOwner = 'c_x') => ({
  amount: 120.5,
  description: 'Fixed a leak',
  invoiceDate: '2026-06-01',
  image: { url: `https://blob.example/owners/${blobOwner}/photo.jpg`, type: 'OTHER' },
  ...over,
})

const submit = (token: string, payload: object) =>
  app.inject({ method: 'POST', url: `/api/submissions/${token}`, payload })

beforeAll(async () => {
  await app.ready()
  landlord = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: landlord.user.id } })
  await landlord.cleanup()
  await app.close()
})

describe('POST /api/submissions/:token', () => {
  it('creates a SUBMITTED invoice owned by the landlord, attributed to the contractor (AE1, AE6)', async () => {
    const c = await makeContractor('Joe Plumber')
    const res = await submit(c.token, submitBody({}, c.blobOwner))
    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('SUBMITTED')

    const inv = await app.prisma.invoice.findUniqueOrThrow({ where: { id: res.json().id } })
    expect(inv.userId).toBe(landlord.user.id) // landlord-owned
    expect(inv.submittedByContractorId).toBe(c.id) // contractor recorded
    expect(inv.status).toBe('SUBMITTED')
    expect(inv.category).toBeNull() // no category until review (AE6)
    expect(inv.invoiceNumber).toBeNull() // unnumbered until approval (KTD-11)
    expect(inv.vendorName).toBe('Joe Plumber') // vendor defaults to contractor name (AE6)

    const created = await app.prisma.invoiceEvent.findFirstOrThrow({
      where: { invoiceId: inv.id, type: 'CREATED' },
    })
    expect(created.actorId).toBe(`contractor:${c.id}`) // contractor-attributed
    expect(created.ownerUserId).toBe(landlord.user.id) // landlord-owned event
  })

  it('rejects a photo outside the contractor’s own prefix (blob gate, not conflated with actorId)', async () => {
    const c = await makeContractor()
    // A blob under the landlord's prefix, or another contractor's, must be refused.
    const res = await submit(c.token, submitBody({}, landlord.user.id))
    expect(res.statusCode).toBe(403)
  })

  it('requires a photo (422 with no image)', async () => {
    const c = await makeContractor()
    const res = await submit(c.token, { amount: 10, description: 'x', invoiceDate: '2026-06-01' })
    expect(res.statusCode).toBe(400) // schema validation (image required)
  })

  it('rejects a future or too-old invoiceDate', async () => {
    const c = await makeContractor()
    expect((await submit(c.token, submitBody({ invoiceDate: '2099-01-01' }, c.blobOwner))).statusCode).toBe(400)
    expect((await submit(c.token, submitBody({ invoiceDate: '2000-01-01' }, c.blobOwner))).statusCode).toBe(400)
  })

  it('a revoked or unknown token returns a uniform 404 and creates nothing', async () => {
    const c = await makeContractor()
    await app.inject({ method: 'POST', url: `/api/contractors/${c.id}/revoke`, headers: { cookie: landlord.cookie } })
    const revoked = await submit(c.token, submitBody({}, c.blobOwner))
    const unknown = await submit('inv_deadbeef_nope', submitBody())
    expect(revoked.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    expect(revoked.json().error.message).toBe(unknown.json().error.message) // identical
    const count = await app.prisma.invoice.count({ where: { submittedByContractorId: c.id } })
    expect(count).toBe(0)
  })

  it('rate-limits the submit endpoint (429 past the per-token threshold)', async () => {
    const c = await makeContractor()
    // Send empty bodies: under the limit they 422; past it the limiter 429s
    // before the handler — no invoices created.
    const codes: number[] = []
    for (let i = 0; i < 12; i++) {
      codes.push((await submit(c.token, {})).statusCode)
    }
    expect(codes).toContain(429)
    expect(await app.prisma.invoice.count({ where: { submittedByContractorId: c.id } })).toBe(0)
  })
})

describe('POST /api/submissions/:token/upload-token', () => {
  it('mints an upload token scoped to the contractor prefix', async () => {
    const c = await makeContractor()
    const res = await app.inject({
      method: 'POST',
      url: `/api/submissions/${c.token}/upload-token`,
      payload: { contentType: 'image/jpeg' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pathname).toContain(`owners/${c.blobOwner}/`)
  })

  it('404s the upload-token route for a dead token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/submissions/inv_dead_token/upload-token`,
      payload: { contentType: 'image/jpeg' },
    })
    expect(res.statusCode).toBe(404)
  })
})
