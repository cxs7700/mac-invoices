import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Mock the storage adapter — the vendor blob-prefix gate is what we test, no
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
    issueUploadToken: vi.fn(async (ownerId: string) => ({
      token: 'client-token',
      pathname: `owners/${ownerId}/p`,
    })),
    signedReadUrl: vi.fn(() => 'https://signed/url'),
  }
})
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()
let landlord: Awaited<ReturnType<typeof createSecondUser>>

const tokenOf = (link: string) => link.split('/submit/')[1]

/** Create a vendor (as the landlord) and return { id, token, blobOwner }. Name
 * defaults to a fresh unique value per call: vendor names are now unique per
 * landlord (case-insensitively — migration 20260807200000), and this file
 * creates several vendors under the one shared landlord. */
async function makeVendor(name = `Joe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    payload: { name, phone: 'x' },
    headers: { cookie: landlord.cookie },
  })
  const body = res.json()
  return { id: body.id, token: tokenOf(body.link), blobOwner: `c_${body.id}` }
}

const submitBody = (over: Record<string, unknown> = {}, blobOwner = 'c_x') => ({
  items: [{ description: 'Fixed a leak', quantity: 1, total: 120.5 }],
  invoiceDate: '2026-06-01',
  images: [{ url: `https://blob.example/owners/${blobOwner}/photo.jpg`, type: 'OTHER' }],
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
  it('creates a SUBMITTED invoice owned by the landlord, attributed to the vendor (AE1, AE6)', async () => {
    const c = await makeVendor('Joe Plumber')
    const res = await submit(c.token, submitBody({}, c.blobOwner))
    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('SUBMITTED')

    const inv = await app.prisma.invoice.findUniqueOrThrow({ where: { id: res.json().id } })
    expect(inv.userId).toBe(landlord.user.id) // landlord-owned
    expect(inv.submittedByVendorId).toBe(c.id) // vendor recorded
    expect(inv.status).toBe('SUBMITTED')
    expect(inv.category).toBeNull() // no category until review (AE6)
    expect(inv.invoiceNumber).toBeNull() // unnumbered until approval (KTD-11)
    expect(inv.vendorName).toBe('Joe Plumber') // vendor defaults to vendor name (AE6)

    const created = await app.prisma.invoiceEvent.findFirstOrThrow({
      where: { invoiceId: inv.id, type: 'CREATED' },
    })
    expect(created.actorId).toBe(`vendor:${c.id}`) // vendor-attributed
    expect(created.ownerUserId).toBe(landlord.user.id) // landlord-owned event
  })

  it('stores every line item and sums the amount server-side', async () => {
    const c = await makeVendor('Itemizer')
    const res = await submit(
      c.token,
      submitBody(
        {
          items: [
            { description: 'Labour', quantity: 3, total: 300 },
            { description: 'Valve', quantity: 1, total: 45.25 },
          ],
        },
        c.blobOwner,
      ),
    )
    expect(res.statusCode).toBe(201)

    const inv = await app.prisma.invoice.findUniqueOrThrow({
      where: { id: res.json().id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    expect(inv.items.map((i) => i.description)).toEqual(['Labour', 'Valve'])
    expect(inv.items.map((i) => i.quantity)).toEqual([3, 1])
    // The client never sends a total — it is derived from the lines.
    expect(inv.amount.toString()).toBe('345.25')
  })

  it('accepts notes and parts ordered from the vendor', async () => {
    const c = await makeVendor('Noter')
    const res = await submit(
      c.token,
      submitBody({ notes: 'Gate code 1234', partsOrdered: 'Moen cartridge' }, c.blobOwner),
    )
    expect(res.statusCode).toBe(201)

    const inv = await app.prisma.invoice.findUniqueOrThrow({ where: { id: res.json().id } })
    expect(inv.notes).toBe('Gate code 1234')
    expect(inv.partsOrdered).toBe('Moen cartridge')
  })

  it('rejects a photo outside the vendor’s own prefix (blob gate, not conflated with actorId)', async () => {
    const c = await makeVendor()
    // A blob under the landlord's prefix, or another vendor's, must be refused.
    const res = await submit(c.token, submitBody({}, landlord.user.id))
    expect(res.statusCode).toBe(403)
  })

  it('requires at least one photo (400 with none / empty array) — AE2', async () => {
    const c = await makeVendor()
    const none = await submit(c.token, {
      items: [{ description: 'x', quantity: 1, total: 10 }],
      invoiceDate: '2026-06-01',
    })
    expect(none.statusCode).toBe(400) // schema: images required
    const empty = await submit(c.token, submitBody({ images: [] }, c.blobOwner))
    expect(empty.statusCode).toBe(400) // schema: images.min(1)
  })

  it('accepts up to the cap, persisting every image; a 6th is rejected — AE2', async () => {
    const c = await makeVendor()
    const five = Array.from({ length: 5 }, (_, i) => ({
      url: `https://blob.example/owners/${c.blobOwner}/p${i}.jpg`,
      type: 'OTHER',
    }))
    const ok = await submit(c.token, submitBody({ images: five }, c.blobOwner))
    expect(ok.statusCode).toBe(201)
    const rows = await app.prisma.invoiceImage.findMany({ where: { invoiceId: ok.json().id } })
    expect(rows).toHaveLength(5)

    const six = [
      ...five,
      { url: `https://blob.example/owners/${c.blobOwner}/p5.jpg`, type: 'OTHER' },
    ]
    expect((await submit(c.token, submitBody({ images: six }, c.blobOwner))).statusCode).toBe(400)
  })

  it('rejects the whole submission if any one photo is outside the vendor’s prefix (gate)', async () => {
    const c = await makeVendor()
    const mixed = [
      { url: `https://blob.example/owners/${c.blobOwner}/ok.jpg`, type: 'OTHER' },
      { url: `https://blob.example/owners/${landlord.user.id}/evil.jpg`, type: 'OTHER' },
    ]
    const res = await submit(c.token, submitBody({ images: mixed }, c.blobOwner))
    expect(res.statusCode).toBe(403)
    expect(await app.prisma.invoice.count({ where: { submittedByVendorId: c.id } })).toBe(0)
  })

  it('rejects a future or too-old invoiceDate', async () => {
    const c = await makeVendor()
    expect(
      (await submit(c.token, submitBody({ invoiceDate: '2099-01-01' }, c.blobOwner))).statusCode,
    ).toBe(400)
    expect(
      (await submit(c.token, submitBody({ invoiceDate: '2000-01-01' }, c.blobOwner))).statusCode,
    ).toBe(400)
  })

  it('a revoked or unknown token returns a uniform 404 and creates nothing', async () => {
    const c = await makeVendor()
    await app.inject({
      method: 'POST',
      url: `/api/vendors/${c.id}/revoke`,
      headers: { cookie: landlord.cookie },
    })
    const revoked = await submit(c.token, submitBody({}, c.blobOwner))
    const unknown = await submit('inv_deadbeef_nope', submitBody())
    expect(revoked.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    expect(revoked.json().error.message).toBe(unknown.json().error.message) // identical
    const count = await app.prisma.invoice.count({ where: { submittedByVendorId: c.id } })
    expect(count).toBe(0)
  })

  it('rate-limits the submit endpoint (429 past the per-token threshold)', async () => {
    const c = await makeVendor()
    // Send empty bodies: under the limit they 422; past it the limiter 429s
    // before the handler — no invoices created.
    const codes: number[] = []
    for (let i = 0; i < 12; i++) {
      codes.push((await submit(c.token, {})).statusCode)
    }
    expect(codes).toContain(429)
    expect(await app.prisma.invoice.count({ where: { submittedByVendorId: c.id } })).toBe(0)
  })
})

describe('POST /api/submissions/:token/upload-token', () => {
  it('mints an upload token scoped to the vendor prefix', async () => {
    const c = await makeVendor()
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
