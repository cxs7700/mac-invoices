import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'

const app = buildApp()
beforeAll(() => app.ready())
afterAll(() => app.close())

describe('GET /api/invoices pagination clamping', () => {
  it('caps an absurd limit at 100', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?limit=1000000' })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination.limit).toBe(100)
  })

  it('falls back to the default limit on a non-numeric value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?limit=abc' })
    expect(res.json().pagination.limit).toBe(50)
  })

  it('floors a negative offset to 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?offset=-5' })
    expect(res.json().pagination.offset).toBe(0)
  })

  it('floors limit=0 to 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?limit=0' })
    expect(res.json().pagination.limit).toBe(1)
  })

  it('rejects an out-of-enum status filter with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?status=BOGUS' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('accepts a valid status filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices?status=PAID' })
    expect(res.statusCode).toBe(200)
  })
})
