import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Mock the storage adapter — image logic + ownership/ledger are what we test; no
// live Blob calls. isOwnedBy/ownerOf mirror the real owner-prefix parsing.
// Mirror the real adapter's pathname parsing (handles full URLs + bare paths).
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
    issueUploadToken: vi.fn(async () => ({ token: 'client-token', pathname: 'owners/u/p' })),
    signedReadUrl: vi.fn(() => 'https://signed/url'),
  }
})
vi.mock('../src/integrations/storage', () => storage)

import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

const app = buildApp()
const PREFIX = 'TEST-IMG-'
let cookie: string
let landlordId: string
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

const eventsFor = (id: string) => app.prisma.invoiceEvent.findMany({ where: { invoiceId: id }, orderBy: { createdAt: 'asc' } })
const imagesFor = (id: string) => app.prisma.invoiceImage.findMany({ where: { invoiceId: id } })
const ownUrl = (name: string) => `https://blob.test/owners/${landlordId}/${name}`

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  const seed = await createOwn('seed')
  landlordId = seed.user.id
})
afterAll(async () => {
  if (createdIds.length) await app.prisma.invoiceEvent.deleteMany({ where: { invoiceId: { in: createdIds } } })
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await app.close()
})

describe('create with an image', () => {
  it('writes the InvoiceImage row + an IMAGE_ATTACHED event', async () => {
    const inv = await createOwn('with', { image: { url: ownUrl('a') } })
    const images = await imagesFor(inv.id)
    expect(images).toHaveLength(1)
    expect(images[0].url).toBe(ownUrl('a'))
    const types = (await eventsFor(inv.id)).map((e) => e.type)
    expect(types).toContain('CREATED')
    expect(types).toContain('IMAGE_ATTACHED')
  })

  it('rejects a foreign blob ref at create (403), creating nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: body('foreign', { image: { url: 'https://blob.test/owners/someone-else/x' } }),
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
    expect(await app.prisma.invoice.findMany({ where: { invoiceNumber: `${PREFIX}foreign` } })).toHaveLength(0)
  })
})

describe('attach / replace / remove', () => {
  it('AE4: attaching when one exists replaces the row, records the event, and reclaims the prior blob', async () => {
    const inv = await createOwn('attach', { image: { url: ownUrl('first') } })
    storage.deleteBlob.mockClear()
    const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/image`, payload: { url: ownUrl('second') }, headers: { cookie } })
    expect(res.statusCode).toBe(204)
    const images = await imagesFor(inv.id)
    expect(images).toHaveLength(1)
    expect(images[0].url).toBe(ownUrl('second'))
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'IMAGE_ATTACHED')).toHaveLength(2)
    expect(storage.deleteBlob).toHaveBeenCalledWith(ownUrl('first'))
  })

  it('rejects a foreign blob ref on attach (403)', async () => {
    const inv = await createOwn('attach-foreign')
    const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/image`, payload: { url: 'https://blob.test/owners/evil/x' }, headers: { cookie } })
    expect(res.statusCode).toBe(403)
    expect(await imagesFor(inv.id)).toHaveLength(0)
  })

  it("does not attach to another user's invoice (404)", async () => {
    const second = await createSecondUser(app)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/invoices', payload: body('second'), headers: { cookie: second.cookie } })
      const otherId = created.json().id
      createdIds.push(otherId)
      const res = await app.inject({ method: 'POST', url: `/api/invoices/${otherId}/image`, payload: { url: ownUrl('x') }, headers: { cookie } })
      expect(res.statusCode).toBe(404)
      expect(await imagesFor(otherId)).toHaveLength(0)
    } finally {
      await second.cleanup()
    }
  })

  it('removes the photo: deletes the row + blob and emits IMAGE_REMOVED', async () => {
    const inv = await createOwn('rm', { image: { url: ownUrl('r') } })
    storage.deleteBlob.mockClear()
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}/image`, headers: { cookie } })).statusCode).toBe(204)
    expect(await imagesFor(inv.id)).toHaveLength(0)
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'IMAGE_REMOVED')).toHaveLength(1)
    expect(storage.deleteBlob).toHaveBeenCalledWith(ownUrl('r'))
    // Removing again 404s (no photo).
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}/image`, headers: { cookie } })).statusCode).toBe(404)
  })
})

describe('delete cleanup', () => {
  it('a deleted invoice snapshots the image url and reclaims the blob', async () => {
    const inv = await createOwn('del', { image: { url: ownUrl('d') } })
    storage.deleteBlob.mockClear()
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}`, headers: { cookie } })).statusCode).toBe(204)
    const tomb = (await eventsFor(inv.id)).find((e) => e.type === 'DELETED')
    expect((tomb!.detail as { snapshot: { imageUrl: string } }).snapshot.imageUrl).toBe(ownUrl('d'))
    expect(storage.deleteBlob).toHaveBeenCalledWith(ownUrl('d'))
  })

  it('blob reclaim is best-effort: a storage failure does not fail the delete', async () => {
    const inv = await createOwn('del-fail', { image: { url: ownUrl('df') } })
    storage.deleteBlob.mockRejectedValueOnce(new Error('storage down'))
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await eventsFor(inv.id)).some((e) => e.type === 'DELETED')).toBe(true)
    expect(await app.prisma.invoice.findFirst({ where: { id: inv.id } })).toBeNull()
  })
})

describe('image-url + upload-token endpoints', () => {
  it('returns a signed url for an owned photo, 404 otherwise', async () => {
    const inv = await createOwn('url', { image: { url: ownUrl('u') } })
    const ok = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/image-url`, headers: { cookie } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().url).toBe('https://signed/url')
    expect(storage.signedReadUrl).toHaveBeenCalledWith(ownUrl('u'))

    const noImg = await createOwn('url-noimg')
    expect((await app.inject({ method: 'GET', url: `/api/invoices/${noImg.id}/image-url`, headers: { cookie } })).statusCode).toBe(404)
  })

  it("does not return another user's image url (404, no existence leak)", async () => {
    const second = await createSecondUser(app)
    try {
      const inv = await createOwn('url-mine', { image: { url: ownUrl('m') } })
      const res = await app.inject({ method: 'GET', url: `/api/invoices/${inv.id}/image-url`, headers: { cookie: second.cookie } })
      expect(res.statusCode).toBe(404)
    } finally {
      await second.cleanup()
    }
  })

  it('issues an upload token (auth required)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/invoices/image-upload-token', payload: { contentType: 'image/png' } })).statusCode).toBe(401)
    const res = await app.inject({ method: 'POST', url: '/api/invoices/image-upload-token', payload: { contentType: 'image/png' }, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBe('client-token')
    expect(storage.issueUploadToken).toHaveBeenCalledWith(landlordId, 'image/png')
  })
})
