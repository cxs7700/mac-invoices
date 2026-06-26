import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// U3 property CRUD + detail (landlord, authed). Ownership-scoped with no
// existence leak; delete is blocked while invoices reference the property; the
// detail rollup sums non-REJECTED/CANCELLED amounts.
const app = buildApp()
let a: Awaited<ReturnType<typeof createSecondUser>>
let b: Awaited<ReturnType<typeof createSecondUser>>

const create = (payload: object, cookie: string) =>
  app.inject({ method: 'POST', url: '/api/properties', payload, headers: { cookie } })
const list = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/properties', headers: { cookie } })
const get = (id: string, cookie: string) =>
  app.inject({ method: 'GET', url: `/api/properties/${id}`, headers: { cookie } })
const patch = (id: string, payload: object, cookie: string) =>
  app.inject({ method: 'PATCH', url: `/api/properties/${id}`, payload, headers: { cookie } })
const del = (id: string, cookie: string) =>
  app.inject({ method: 'DELETE', url: `/api/properties/${id}`, headers: { cookie } })

// Make an invoice directly (bypassing the API) assigned to a property.
const invoice = (userId: string, propertyId: string, status: string, amount: number) =>
  app.prisma.invoice.create({
    data: {
      vendorName: 'V', description: 'D', amount, propertyId, userId,
      status: status as never, invoiceDate: new Date(),
    },
  })

beforeAll(async () => {
  await app.ready()
  a = await createSecondUser(app)
  b = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: { in: [a.user.id, b.user.id] } } })
  await a.cleanup()
  await b.cleanup()
  await app.close()
})

describe('property CRUD', () => {
  it('creates a property and lists it; detail shows 0.00 spend with no invoices', async () => {
    const res = await create({ name: '123 Main St', address: 'Anytown', notes: 'duplex' }, a.cookie)
    expect(res.statusCode).toBe(201)
    const id = res.json().id
    expect((await list(a.cookie)).json().data.some((p: { id: string }) => p.id === id)).toBe(true)
    const detail = await get(id, a.cookie)
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ name: '123 Main St', totalSpend: '0.00' })
  })

  it('allows a missing/empty name (address is the only required field); requires auth', async () => {
    const res = await create({ address: '742 Evergreen Terrace' }, a.cookie)
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('')
    expect((await create({ name: '', address: 'x' }, a.cookie)).statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/api/properties' })).statusCode).toBe(401)
  })

  it('is ownership-scoped: another landlord gets 404 and never sees it', async () => {
    const id = (await create({ name: 'Scoped', address: 'x' }, a.cookie)).json().id
    expect((await get(id, b.cookie)).statusCode).toBe(404)
    expect((await patch(id, { name: 'hax' }, b.cookie)).statusCode).toBe(404)
    expect((await del(id, b.cookie)).statusCode).toBe(404)
    expect((await list(b.cookie)).json().data.some((p: { id: string }) => p.id === id)).toBe(false)
  })

  it('updates name/address/notes', async () => {
    const id = (await create({ name: 'Old', address: 'A', notes: 'n' }, a.cookie)).json().id
    const res = await patch(id, { name: 'New', address: 'B' }, a.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'New', address: 'B', notes: 'n' })
  })
})

describe('delete guard + spend rollup', () => {
  it('blocks delete while invoices reference the property, then allows it after reassign (AE2)', async () => {
    const id = (await create({ name: 'Del', address: 'x' }, a.cookie)).json().id
    const i1 = await invoice(a.user.id, id, 'PAID', 100)
    const i2 = await invoice(a.user.id, id, 'APPROVED', 50)

    const blocked = await del(id, a.cookie)
    expect(blocked.statusCode).toBe(422)
    expect(blocked.json().error.message).toMatch(/2 invoices/)

    // Reassign both away, then delete succeeds.
    await app.prisma.invoice.updateMany({ where: { id: { in: [i1.id, i2.id] } }, data: { propertyId: null } })
    expect((await del(id, a.cookie)).statusCode).toBe(204)
  })

  it('rolls up spend excluding REJECTED/CANCELLED (AE3)', async () => {
    const id = (await create({ name: 'Spend', address: 'x' }, a.cookie)).json().id
    await invoice(a.user.id, id, 'PAID', 100)
    await invoice(a.user.id, id, 'APPROVED', 50)
    await invoice(a.user.id, id, 'REJECTED', 30)
    const detail = await get(id, a.cookie)
    expect(detail.json().totalSpend).toBe('150.00')
  })
})
