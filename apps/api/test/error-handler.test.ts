import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import Fastify from 'fastify'
import { AppError, errorHandler, notFoundHandler } from '../src/middleware/errorHandler'
import { buildApp } from '../src/app'

// Minimal app wired to the real handler, with routes that throw the cases we map.
function makeApp() {
  const app = Fastify()
  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)
  app.get('/app-error', async () => {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  })
  app.get('/p2002', async () => {
    throw Object.assign(new Error('dup'), { code: 'P2002' })
  })
  app.get('/p2025', async () => {
    throw Object.assign(new Error('missing'), { code: 'P2025' })
  })
  app.get('/boom', async () => {
    throw new Error('kaboom: secret stack detail')
  })
  return app
}

const app = makeApp()
beforeAll(() => app.ready())
afterAll(() => app.close())

describe('errorHandler (§7 shape)', () => {
  it('renders AppError with its code + status', async () => {
    const res = await app.inject({ method: 'GET', url: '/app-error' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } })
  })

  it('maps Prisma P2002 → 409', async () => {
    const res = await app.inject({ method: 'GET', url: '/p2002' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
  })

  it('maps Prisma P2025 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/p2025' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('maps unknown errors → 500 with no stack leak', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(res.body).not.toContain('secret stack detail')
  })
})

describe('notFoundHandler', () => {
  it('returns the standard shape for unknown routes on the real app', async () => {
    const real = buildApp()
    const res = await real.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    await real.close()
  })
})
