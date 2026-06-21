import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'

// Integration test against the real dev database (KTD-5). Rows use a TEST- prefix
// and are cleaned up before and after the run so reruns stay isolated.
const app = buildApp()
const PREFIX = 'TEST-CREATE-'

const validBody = {
  invoiceNumber: `${PREFIX}1`,
  vendorName: 'Acme Plumbing',
  description: 'Replaced a valve',
  amount: 149.99,
  category: 'REPAIRS',
  invoiceDate: '2026-01-15',
}

async function cleanup() {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
}

beforeAll(async () => {
  await app.ready()
  await cleanup()
})
afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('POST /api/invoices', () => {
  it('creates an invoice and returns 201 with a cuid id and the landlord owner', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invoices', payload: validBody })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(typeof body.id).toBe('string')
    expect(body.invoiceNumber).toBe(validBody.invoiceNumber)
    expect(body.vendorName).toBe('Acme Plumbing')
    expect(body.category).toBe('REPAIRS')
    expect(body.status).toBe('PENDING')
    // Prisma serializes Decimal as a string on responses (CONV-013).
    expect(body.amount).toBe('149.99')
    expect(body.userId).toBe(process.env.LANDLORD_USER_ID)
  })

  it('ignores a client-supplied userId and uses the landlord', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}2`, userId: 'attacker-controlled' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().userId).toBe(process.env.LANDLORD_USER_ID)
  })

  it('rejects an invalid body with 400 VALIDATION_ERROR + details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}3`, amount: -5, category: 'NOPE' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(res.json().error.details).toBeDefined()
  })

  it('rejects a duplicate invoiceNumber with 409', async () => {
    const dup = { ...validBody, invoiceNumber: `${PREFIX}dup` }
    const first = await app.inject({ method: 'POST', url: '/api/invoices', payload: dup })
    expect(first.statusCode).toBe(201)
    const second = await app.inject({ method: 'POST', url: '/api/invoices', payload: dup })
    expect(second.statusCode).toBe(409)
  })

  it('returns 500 CONFIG_ERROR when LANDLORD_USER_ID is unset', async () => {
    const saved = process.env.LANDLORD_USER_ID
    delete process.env.LANDLORD_USER_ID
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: { ...validBody, invoiceNumber: `${PREFIX}cfg` },
      })
      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe('CONFIG_ERROR')
    } finally {
      process.env.LANDLORD_USER_ID = saved
    }
  })
})

describe('GET /api/invoices/:id', () => {
  it('returns 200 for an existing invoice and 404 for an unknown id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: { ...validBody, invoiceNumber: `${PREFIX}get` },
    })
    const { id } = created.json()

    const found = await app.inject({ method: 'GET', url: `/api/invoices/${id}` })
    expect(found.statusCode).toBe(200)
    expect(found.json().invoiceNumber).toBe(`${PREFIX}get`)

    const missing = await app.inject({ method: 'GET', url: '/api/invoices/does-not-exist' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
  })
})
