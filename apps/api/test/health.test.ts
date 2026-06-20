import { describe, it, expect, afterAll } from 'vitest'
import { buildApp } from '../src/app'

const app = buildApp()
afterAll(() => app.close())

describe('GET /api/health', () => {
  it('returns 200 with { status: ok }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('responds with JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['content-type']).toContain('application/json')
  })
})
