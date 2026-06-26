import { describe, it, expect, afterAll } from 'vitest'
import { buildApp } from '../src/app'

const app = buildApp()
afterAll(() => app.close())

describe('security headers (@fastify/helmet)', () => {
  it('sets nosniff, frame-deny, CSP, and HSTS on a response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    const csp = res.headers['content-security-policy']
    expect(csp).toContain("default-src 'none'")
    // The explicit frame-ancestors directive must survive (a config regression
    // dropping it would otherwise pass a contains-only check).
    expect(csp).toContain("frame-ancestors 'none'")
    // Assert a real max-age, not just presence — hsts:false or max-age=0 is a
    // misconfiguration that .toBeDefined() would miss.
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/)
  })

  it('does not break the JSON response body', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
