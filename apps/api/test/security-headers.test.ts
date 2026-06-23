import { describe, it, expect, afterAll } from 'vitest'
import { buildApp } from '../src/app'

const app = buildApp()
afterAll(() => app.close())

describe('security headers (@fastify/helmet)', () => {
  it('sets nosniff, frame-deny, CSP, and HSTS on a response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['strict-transport-security']).toBeDefined()
  })

  it('does not break the JSON response body', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
