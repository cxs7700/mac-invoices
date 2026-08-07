import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie } from './helpers/auth'

// Integration test against the real dev database (KTD-5/9). Authenticates as the
// seeded landlord; rows use a TEST- prefix and are cleaned up around the run.
const app = buildApp()
const PREFIX = 'TEST-CREATE-'
let cookie: string

const validBody = {
  invoiceNumber: `${PREFIX}1`,
  vendorName: 'Acme Plumbing',
  items: [{ description: 'Replaced a valve', quantity: 1, total: 149.99 }],
  category: 'REPAIRS',
  invoiceDate: '2026-01-15',
}

// Auto-numbered invoices get a numeric invoiceNumber (no PREFIX), so track their
// ids and clean them up by id.
const autoIds: string[] = []

async function cleanup() {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  if (autoIds.length) {
    await app.prisma.invoice.deleteMany({ where: { id: { in: autoIds.splice(0) } } })
  }
}

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  await cleanup()
})
afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('POST /api/invoices', () => {
  it('401s without a session cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invoices', payload: validBody })
    expect(res.statusCode).toBe(401)
  })

  it('creates an invoice owned by the session user, amount = sum of item totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: validBody,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.id).toBe('string')
    expect(body.invoiceNumber).toBe(validBody.invoiceNumber)
    expect(body.vendorName).toBe('Acme Plumbing')
    expect(body.category).toBe('REPAIRS')
    expect(body.status).toBe('PENDING')
    expect(body.amount).toBe('149.99')
    expect(body.userId).toBe(process.env.LANDLORD_USER_ID)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ description: 'Replaced a valve', quantity: 1 })
  })

  it('sums multiple item totals into amount, in sortOrder', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        ...validBody,
        invoiceNumber: `${PREFIX}multi`,
        items: [
          { description: 'Drywall', quantity: 1, total: 200 },
          { description: 'Paint', quantity: 2, total: 50.5 },
        ],
      },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    // Prisma's Decimal renders without a forced 2dp (trailing zeros drop) —
    // compare numerically, not by exact string.
    expect(Number(body.amount)).toBe(250.5)
    expect(body.items.map((i: { description: string }) => i.description)).toEqual([
      'Drywall',
      'Paint',
    ])
  })

  it('ignores a client-supplied userId and uses the session user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}2`, userId: 'attacker-controlled' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().userId).toBe(process.env.LANDLORD_USER_ID)
  })

  it('rejects an invalid body with 400 VALIDATION_ERROR + details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}3`, items: [], category: 'NOPE' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(res.json().error.details).toBeDefined()
  })

  it('auto-assigns the next sequential number when none is supplied', async () => {
    // Body intentionally omits invoiceNumber — the server assigns it.
    const autoBody = {
      vendorName: 'Auto Co',
      items: [{ description: 'Auto numbered work', quantity: 1, total: 10 }],
      category: 'OTHER',
      invoiceDate: '2026-03-01',
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: autoBody,
      headers: { cookie },
    })
    expect(first.statusCode).toBe(201)
    autoIds.push(first.json().id)
    const n1 = first.json().invoiceNumber
    expect(n1).toMatch(/^\d+$/) // numeric string, continuing the existing sequence

    const second = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: autoBody,
      headers: { cookie },
    })
    expect(second.statusCode).toBe(201)
    autoIds.push(second.json().id)
    // The next create increments by exactly one.
    expect(Number(second.json().invoiceNumber)).toBe(Number(n1) + 1)
  })

  it('rejects a duplicate invoiceNumber with 409', async () => {
    const dup = { ...validBody, invoiceNumber: `${PREFIX}dup` }
    const first = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: dup,
      headers: { cookie },
    })
    expect(first.statusCode).toBe(201)
    const second = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: dup,
      headers: { cookie },
    })
    expect(second.statusCode).toBe(409)
  })
})

describe('GET /api/invoices/:id', () => {
  it('returns 200 for an own invoice and 404 for an unknown id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}get` },
      headers: { cookie },
    })
    const { id } = created.json()

    const found = await app.inject({
      method: 'GET',
      url: `/api/invoices/${id}`,
      headers: { cookie },
    })
    expect(found.statusCode).toBe(200)
    expect(found.json().invoiceNumber).toBe(`${PREFIX}get`)
    expect(found.json().items).toHaveLength(1)

    const missing = await app.inject({
      method: 'GET',
      url: '/api/invoices/does-not-exist',
      headers: { cookie },
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
  })
})
