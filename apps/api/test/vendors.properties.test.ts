import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// Which properties a landlord has assigned to a vendor (GET/PUT
// /api/vendors/:id/properties). This is the set the vendor's submission link
// offers, so the tenant boundary here is load-bearing: the join table's
// composite PK does not encode it.
const app = buildApp()
let cookie: string
let other: Awaited<ReturnType<typeof createSecondUser>>
let landlordId: string

const NAME_PREFIX = 'VP-'

async function makeVendor(name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    payload: { name: `${NAME_PREFIX}${name}`, phone: '5551234567' },
    headers: { cookie },
  })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: string; propertyCount: number }
}

async function makeProperty(name: string, ownerId = landlordId) {
  return app.prisma.property.create({
    data: { landlordId: ownerId, name: `${NAME_PREFIX}${name}`, address: `${name} Road` },
  })
}

const get = (vendorId: string, c = cookie) =>
  app.inject({ method: 'GET', url: `/api/vendors/${vendorId}/properties`, headers: { cookie: c } })

const put = (vendorId: string, propertyIds: string[], c = cookie) =>
  app.inject({
    method: 'PUT',
    url: `/api/vendors/${vendorId}/properties`,
    payload: { propertyIds },
    headers: { cookie: c },
  })

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
  landlordId = me.json().id
  other = await createSecondUser(app)
})

afterAll(async () => {
  await app.prisma.vendor.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } })
  await app.prisma.property.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } })
  await other.cleanup()
  await app.close()
})

describe('GET /api/vendors/:id/properties', () => {
  it('starts empty and returns the assigned set once written', async () => {
    const vendor = await makeVendor('reader')
    const a = await makeProperty('Alpha')

    const before = await get(vendor.id)
    expect(before.statusCode).toBe(200)
    expect(before.json().data).toEqual([])

    await put(vendor.id, [a.id])

    const after = await get(vendor.id)
    expect(after.json().data.map((p: { id: string }) => p.id)).toEqual([a.id])
    // The submission link reads the same id/name/address shape — never notes.
    expect(Object.keys(after.json().data[0])).toEqual(['id', 'name', 'address'])
  })

  it('404s another landlord’s vendor (no existence leak)', async () => {
    const vendor = await makeVendor('not-yours')
    const res = await get(vendor.id, other.cookie)
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/vendors/:id/properties', () => {
  it('replaces the whole set rather than merging', async () => {
    const vendor = await makeVendor('replacer')
    const a = await makeProperty('Beta')
    const b = await makeProperty('Gamma')

    await put(vendor.id, [a.id, b.id])
    expect((await get(vendor.id)).json().data).toHaveLength(2)

    // Replace, not add: b must be gone.
    const res = await put(vendor.id, [a.id])
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((p: { id: string }) => p.id)).toEqual([a.id])
  })

  it('is idempotent', async () => {
    const vendor = await makeVendor('idempotent')
    const a = await makeProperty('Delta')

    await put(vendor.id, [a.id])
    const second = await put(vendor.id, [a.id])
    expect(second.statusCode).toBe(200)
    expect(second.json().data.map((p: { id: string }) => p.id)).toEqual([a.id])
  })

  it('accepts duplicate ids in the payload without tripping the composite PK', async () => {
    const vendor = await makeVendor('duper')
    const a = await makeProperty('Epsilon')

    const res = await put(vendor.id, [a.id, a.id])
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })

  it('unassigns everything on an empty array', async () => {
    const vendor = await makeVendor('clearer')
    const a = await makeProperty('Zeta')

    await put(vendor.id, [a.id])
    const res = await put(vendor.id, [])
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it('rejects another landlord’s property and writes nothing', async () => {
    const vendor = await makeVendor('trespasser')
    const mine = await makeProperty('Eta')
    const foreign = await makeProperty('Theta', other.user.id)

    const res = await put(vendor.id, [mine.id, foreign.id])
    expect(res.statusCode).toBe(400)
    // The whole write is one transaction, so the legitimate half must not land.
    expect((await get(vendor.id)).json().data).toEqual([])
  })

  it('404s another landlord’s vendor', async () => {
    const vendor = await makeVendor('foreign-vendor')
    const theirProperty = await makeProperty('Iota', other.user.id)
    const res = await put(vendor.id, [theirProperty.id], other.cookie)
    expect(res.statusCode).toBe(404)
  })
})

describe('propertyCount on the vendor list', () => {
  it('reports the number assigned', async () => {
    const vendor = await makeVendor('counted')
    const a = await makeProperty('Kappa')
    const b = await makeProperty('Lambda')

    const created = await app.inject({
      method: 'GET',
      url: '/api/vendors',
      headers: { cookie },
    })
    const before = created.json().data.find((v: { id: string }) => v.id === vendor.id)
    expect(before.propertyCount).toBe(0)

    await put(vendor.id, [a.id, b.id])

    const listed = await app.inject({ method: 'GET', url: '/api/vendors', headers: { cookie } })
    const after = listed.json().data.find((v: { id: string }) => v.id === vendor.id)
    expect(after.propertyCount).toBe(2)
  })
})

describe('deleting a property', () => {
  it('drops the assignment without touching the vendor', async () => {
    const vendor = await makeVendor('survivor')
    const a = await makeProperty('Mu')
    await put(vendor.id, [a.id])

    await app.prisma.property.delete({ where: { id: a.id } })

    // Cascade on the join row only — the vendor is still there, just unassigned.
    expect((await get(vendor.id)).json().data).toEqual([])
    expect(await app.prisma.vendor.count({ where: { id: vendor.id } })).toBe(1)
  })
})
