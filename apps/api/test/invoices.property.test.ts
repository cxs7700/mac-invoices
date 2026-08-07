import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// U4 invoice↔property: assignment ownership (404, not 403), required-on-approval
// at both APPROVED checkpoints (category checked first), and the list filter
// including the "none" unassigned bucket.
const app = buildApp()
let a: Awaited<ReturnType<typeof createSecondUser>>
let b: Awaited<ReturnType<typeof createSecondUser>>
let propA: string
let propB: string

const post = (payload: object, cookie: string) =>
  app.inject({ method: 'POST', url: '/api/invoices', payload, headers: { cookie } })
const patch = (id: string, payload: object, cookie: string) =>
  app.inject({ method: 'PATCH', url: `/api/invoices/${id}`, payload, headers: { cookie } })
const listBy = (qs: string, cookie: string) =>
  app.inject({ method: 'GET', url: `/api/invoices?${qs}`, headers: { cookie } })

const base = {
  vendorName: 'V',
  items: [{ description: 'work', quantity: 1, total: 100 }],
  invoiceDate: '2026-03-01',
}
// A SUBMITTED row (contractor-style: no category, no property) created directly.
const submitted = (n: string) =>
  app.prisma.invoice.create({
    data: { vendorName: 'C', description: 'w', amount: '100.00', invoiceDate: new Date(), status: 'SUBMITTED', userId: a.user.id, invoiceNumber: `P-${n}` },
  })

beforeAll(async () => {
  await app.ready()
  a = await createSecondUser(app)
  b = await createSecondUser(app)
  propA = (await app.prisma.property.create({ data: { landlordId: a.user.id, name: 'PA', address: 'A' } })).id
  propB = (await app.prisma.property.create({ data: { landlordId: b.user.id, name: 'PB', address: 'B' } })).id
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: { in: [a.user.id, b.user.id] } } })
  await a.cleanup()
  await b.cleanup()
  await app.close()
})

describe('required-on-approval (AE1)', () => {
  it('blocks approving a submission with no property, then succeeds once set', async () => {
    const inv = await submitted('sub-approve')
    const blocked = await patch(inv.id, { status: 'APPROVED', category: 'LABOR' }, a.cookie)
    expect(blocked.statusCode).toBe(422)
    expect(blocked.json().error.code).toBe('PROPERTY_REQUIRED')
    const ok = await patch(inv.id, { status: 'APPROVED', category: 'LABOR', propertyId: propA }, a.cookie)
    expect(ok.statusCode).toBe(200)
    expect(ok.json().status).toBe('APPROVED')
  })

  it('blocks approving a PENDING invoice directly with no property (catch-all checkpoint)', async () => {
    const id = (await post({ ...base, category: 'REPAIRS' }, a.cookie)).json().id
    const blocked = await patch(id, { status: 'APPROVED' }, a.cookie)
    expect(blocked.statusCode).toBe(422)
    expect(blocked.json().error.code).toBe('PROPERTY_REQUIRED')
    expect((await patch(id, { status: 'APPROVED', propertyId: propA }, a.cookie)).statusCode).toBe(200)
  })

  it('checks category before property when both are missing', async () => {
    const inv = await submitted('order')
    const res = await patch(inv.id, { status: 'APPROVED' }, a.cookie)
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('CATEGORY_REQUIRED')
  })
})

describe('assignment ownership (404, no leak)', () => {
  it('rejects assigning another landlord’s property on create, accepts own', async () => {
    expect((await post({ ...base, category: 'REPAIRS', propertyId: propB }, a.cookie)).statusCode).toBe(404)
    expect((await post({ ...base, category: 'REPAIRS', propertyId: propA }, a.cookie)).statusCode).toBe(201)
  })

  it('rejects assigning another landlord’s property on update, accepts own', async () => {
    const id = (await post({ ...base, category: 'REPAIRS' }, a.cookie)).json().id
    expect((await patch(id, { propertyId: propB }, a.cookie)).statusCode).toBe(404)
    expect((await patch(id, { propertyId: propA }, a.cookie)).statusCode).toBe(200)
  })
})

describe('list filter (AE4)', () => {
  it('filters by property id and by the "none" unassigned bucket', async () => {
    await post({ ...base, category: 'REPAIRS', propertyId: propA, invoiceNumber: 'PF-assigned' }, a.cookie)
    await post({ ...base, category: 'REPAIRS', invoiceNumber: 'PF-unassigned' }, a.cookie)

    const byProp = (await listBy(`propertyId=${propA}`, a.cookie)).json().data
    expect(byProp.length).toBeGreaterThan(0)
    expect(byProp.every((i: { propertyId: string | null }) => i.propertyId === propA)).toBe(true)

    const unassigned = (await listBy('propertyId=none', a.cookie)).json().data
    expect(unassigned.length).toBeGreaterThan(0)
    expect(unassigned.every((i: { propertyId: string | null }) => i.propertyId === null)).toBe(true)
  })
})
