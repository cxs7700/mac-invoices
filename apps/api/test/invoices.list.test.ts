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
})
