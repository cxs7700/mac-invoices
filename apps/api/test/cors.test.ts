import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { buildApp } from '../src/app'

const ORIGIN = 'http://localhost:5173'
const app = buildApp()
beforeAll(() => app.ready())
afterAll(() => app.close())

describe('CORS', () => {
  it('allows the configured origin with credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: ORIGIN },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('serves requests with no origin header (same-origin / curl)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })
})
