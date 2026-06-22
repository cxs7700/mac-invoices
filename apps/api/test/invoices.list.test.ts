import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie } from './helpers/auth'

const app = buildApp()
let cookie: string

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
})
afterAll(() => app.close())

describe('GET /api/invoices', () => {
  it('401s without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/invoices' })
    expect(res.statusCode).toBe(401)
  })

  it('caps an absurd limit at 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?limit=1000000',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pagination.limit).toBe(100)
  })

  it('falls back to the default limit on a non-numeric value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/invoices?limit=abc',
      headers: { cookie },
    })
    expect(res.json().pagination.limit).toBe(50)
  })

  it('floors a negative offset to 0 and limit=0 to 1', async () => {
    const off = await app.inject({
      method: 'GET',
      url: '/api/invoices?offset=-5',
      headers: { cookie },
    })
    expect(off.json().pagination.offset).toBe(0)
    const lim = await app.inject({
      method: 'GET',
      url: '/api/invoices?limit=0',
      headers: { cookie },
    })
    expect(lim.json().pagination.limit).toBe(1)
  })

  it('rejects an out-of-enum status filter with 400 and accepts a valid one', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/api/invoices?status=BOGUS',
      headers: { cookie },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('VALIDATION_ERROR')

    const ok = await app.inject({
      method: 'GET',
      url: '/api/invoices?status=PAID',
      headers: { cookie },
    })
    expect(ok.statusCode).toBe(200)
  })
})
