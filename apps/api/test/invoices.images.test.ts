import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Mock the storage adapter — image logic + ownership/ledger are what we test; no
// live Blob calls. isOwnedBy/ownerOf mirror the real owner-prefix parsing.
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
import { backfillInvoiceImages } from '../prisma/backfill-invoice-images'
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
const listImages = (id: string, c = cookie) =>
  app.inject({ method: 'GET', url: `/api/invoices/${id}/images`, headers: { cookie: c } })
const addImage = (id: string, url: string, type?: string, c = cookie) =>
  app.inject({ method: 'POST', url: `/api/invoices/${id}/images`, payload: type ? { url, type } : { url }, headers: { cookie: c } })

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

describe('create with images[]', () => {
  it('writes a row + IMAGE_ATTACHED event per supplied image', async () => {
    const inv = await createOwn('with', { images: [{ url: ownUrl('a') }, { url: ownUrl('b'), type: 'CASH' }] })
    const images = await imagesFor(inv.id)
    expect(images).toHaveLength(2)
    expect(images.map((i) => i.url).sort()).toEqual([ownUrl('a'), ownUrl('b')].sort())
    const attached = (await eventsFor(inv.id)).filter((e) => e.type === 'IMAGE_ATTACHED')
    expect(attached).toHaveLength(2)
  })

  it('allows 0 images (create now, photograph later)', async () => {
    const inv = await createOwn('none', { images: [] })
    expect(await imagesFor(inv.id)).toHaveLength(0)
  })

  it('rejects a foreign blob ref at create (403), creating nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: body('foreign', { images: [{ url: 'https://blob.test/owners/someone-else/x' }] }),
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
    expect(await app.prisma.invoice.findMany({ where: { invoiceNumber: `${PREFIX}foreign` } })).toHaveLength(0)
  })
})

describe('GET /:id/images', () => {
  it('returns each row with a signed url + type', async () => {
    const inv = await createOwn('list', { images: [{ url: ownUrl('l1'), type: 'PARTS' }] })
    const res = await listImages(inv.id)
    expect(res.statusCode).toBe(200)
    const data = res.json().data as { id: string; url: string; type: string }[]
    expect(data).toHaveLength(1)
    expect(data[0].url).toBe('https://signed/url')
    expect(data[0].type).toBe('PARTS')
    expect(storage.signedReadUrl).toHaveBeenCalledWith(ownUrl('l1'))
  })
})

describe('POST /:id/images — append + cap', () => {
  it('appends a photo and records the event', async () => {
    const inv = await createOwn('append')
    expect((await addImage(inv.id, ownUrl('p1'), 'CHECK')).statusCode).toBe(204)
    const images = await imagesFor(inv.id)
    expect(images).toHaveLength(1)
    expect(images[0].type).toBe('CHECK')
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'IMAGE_ATTACHED')).toHaveLength(1)
  })

  it('AE1: a 6th photo is rejected with 422 IMAGE_LIMIT', async () => {
    const inv = await createOwn('cap', {
      images: Array.from({ length: 5 }, (_, i) => ({ url: ownUrl(`c${i}`) })),
    })
    const res = await addImage(inv.id, ownUrl('sixth'))
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('IMAGE_LIMIT')
    expect(await imagesFor(inv.id)).toHaveLength(5)
  })

  it('rejects a foreign blob ref on append (403)', async () => {
    const inv = await createOwn('append-foreign')
    const res = await addImage(inv.id, 'https://blob.test/owners/evil/x')
    expect(res.statusCode).toBe(403)
    expect(await imagesFor(inv.id)).toHaveLength(0)
  })
})

describe('PATCH /:id/images/:imageId — set type', () => {
  it('AE5: retags OTHER → CASH and persists', async () => {
    const inv = await createOwn('retype', { images: [{ url: ownUrl('rt') }] })
    const imageId = (await imagesFor(inv.id))[0].id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/invoices/${inv.id}/images/${imageId}`,
      payload: { type: 'CASH' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(204)
    expect((await imagesFor(inv.id))[0].type).toBe('CASH')
  })
})

describe('DELETE /:id/images/:imageId — remove by id', () => {
  it('removes the row + blob and emits IMAGE_REMOVED', async () => {
    const inv = await createOwn('rm', { images: [{ url: ownUrl('r1') }, { url: ownUrl('r2') }] })
    const imageId = (await imagesFor(inv.id)).find((i) => i.url === ownUrl('r1'))!.id
    storage.deleteBlob.mockClear()
    const res = await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}/images/${imageId}`, headers: { cookie } })
    expect(res.statusCode).toBe(204)
    const images = await imagesFor(inv.id)
    expect(images).toHaveLength(1)
    expect(images[0].url).toBe(ownUrl('r2'))
    expect((await eventsFor(inv.id)).filter((e) => e.type === 'IMAGE_REMOVED')).toHaveLength(1)
    expect(storage.deleteBlob).toHaveBeenCalledWith(ownUrl('r1'))
  })

  it('blob reclaim is best-effort: a storage failure still removes the row (204)', async () => {
    const inv = await createOwn('rm-fail', { images: [{ url: ownUrl('rf') }] })
    const imageId = (await imagesFor(inv.id))[0].id
    storage.deleteBlob.mockRejectedValueOnce(new Error('storage down'))
    const res = await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}/images/${imageId}`, headers: { cookie } })
    expect(res.statusCode).toBe(204)
    expect(await imagesFor(inv.id)).toHaveLength(0)
  })
})

describe('ownership + IDOR (KTD-2a)', () => {
  it("a second landlord cannot list/add/remove/patch on this invoice (404)", async () => {
    const second = await createSecondUser(app)
    try {
      const inv = await createOwn('owned', { images: [{ url: ownUrl('o1') }] })
      const imageId = (await imagesFor(inv.id))[0].id
      const secondUrl = `https://blob.test/owners/${second.user.id}/o2`
      expect((await listImages(inv.id, second.cookie)).statusCode).toBe(404)
      // Posts a blob the second landlord owns (gate passes) → invoice ownership 404.
      expect((await addImage(inv.id, secondUrl, undefined, second.cookie)).statusCode).toBe(404)
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}/images/${imageId}`, headers: { cookie: second.cookie } })).statusCode,
      ).toBe(404)
      expect(
        (await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}/images/${imageId}`, payload: { type: 'CASH' }, headers: { cookie: second.cookie } })).statusCode,
      ).toBe(404)
    } finally {
      await second.cleanup()
    }
  })

  it("remove/patch of an imageId from a different invoice 404s (no IDOR)", async () => {
    const a = await createOwn('idor-a', { images: [{ url: ownUrl('ia') }] })
    const b = await createOwn('idor-b', { images: [{ url: ownUrl('ib') }] })
    const bImageId = (await imagesFor(b.id))[0].id
    // Try to delete B's image via A's invoice path — the ownership+invoice-joined query misses → 404.
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/invoices/${a.id}/images/${bImageId}`, headers: { cookie } })).statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/invoices/${a.id}/images/${bImageId}`, payload: { type: 'CASH' }, headers: { cookie } })).statusCode,
    ).toBe(404)
    // B's image is untouched.
    expect(await imagesFor(b.id)).toHaveLength(1)
  })
})

describe('delete invoice — reclaims every blob (KTD-6)', () => {
  it('reclaims all blobs and tombstones every url', async () => {
    const inv = await createOwn('del', { images: [{ url: ownUrl('d1') }, { url: ownUrl('d2') }, { url: ownUrl('d3') }] })
    storage.deleteBlob.mockClear()
    expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${inv.id}`, headers: { cookie } })).statusCode).toBe(204)
    const tomb = (await eventsFor(inv.id)).find((e) => e.type === 'DELETED')
    const urls = (tomb!.detail as { snapshot: { imageUrls: string[] } }).snapshot.imageUrls
    expect(urls.sort()).toEqual([ownUrl('d1'), ownUrl('d2'), ownUrl('d3')].sort())
    expect(storage.deleteBlob).toHaveBeenCalledTimes(3)
  })
})

describe('attachmentUrl backfill (AE4, U3)', () => {
  it('folds a legacy attachmentUrl into one image row; idempotent re-run adds nothing', async () => {
    // Seed an invoice that has only the legacy column, no image rows.
    const legacy = await app.prisma.invoice.create({
      data: {
        invoiceNumber: `${PREFIX}legacy`,
        vendorName: 'Vendor',
        description: 'Work',
        amount: 100,
        category: 'OTHER',
        invoiceDate: new Date('2026-02-01'),
        userId: landlordId,
        attachmentUrl: ownUrl('legacy'),
      },
    })
    createdIds.push(legacy.id)
    expect(await imagesFor(legacy.id)).toHaveLength(0)

    const first = await backfillInvoiceImages(app.prisma)
    expect(first.imagesCreated).toBeGreaterThanOrEqual(1)
    const rows = await imagesFor(legacy.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe(ownUrl('legacy'))
    expect(rows[0].type).toBe('OTHER')

    // Idempotent: a second run creates nothing for this invoice.
    await backfillInvoiceImages(app.prisma)
    expect(await imagesFor(legacy.id)).toHaveLength(1)
  })
})

describe('upload-token endpoint', () => {
  it('issues an upload token (auth required)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/invoices/image-upload-token', payload: { contentType: 'image/png' } })).statusCode).toBe(401)
    const res = await app.inject({ method: 'POST', url: '/api/invoices/image-upload-token', payload: { contentType: 'image/png' }, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBe('client-token')
    expect(storage.issueUploadToken).toHaveBeenCalledWith(landlordId, 'image/png')
  })
})
