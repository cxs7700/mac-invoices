import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// Mock the flush — this test is about the CRON_SECRET gate, not flush behavior.
const runDigestFlush = vi.hoisted(() => vi.fn(async () => ({ landlords: 0, events: 0, sent: 0, failed: 0 })))
vi.mock('../src/notifications/digest', () => ({ runDigestFlush }))

import { buildApp } from '../src/app'

const app = buildApp()
const SECRET = 'test-cron-secret'
const post = (headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/cron/notify-digest', headers })

beforeAll(async () => { await app.ready() })
beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = SECRET })
afterAll(async () => { delete process.env.CRON_SECRET; await app.close() })

describe('POST /api/cron/notify-digest', () => {
  it('401s with no Authorization header and does not run the flush', async () => {
    const res = await post()
    expect(res.statusCode).toBe(401)
    expect(runDigestFlush).not.toHaveBeenCalled()
  })

  it('401s with a wrong bearer token', async () => {
    const res = await post({ authorization: 'Bearer nope' })
    expect(res.statusCode).toBe(401)
    expect(runDigestFlush).not.toHaveBeenCalled()
  })

  it('fails closed (401) when CRON_SECRET is unset, even with a bearer', async () => {
    delete process.env.CRON_SECRET
    const res = await post({ authorization: 'Bearer anything' })
    expect(res.statusCode).toBe(401)
    expect(runDigestFlush).not.toHaveBeenCalled()
  })

  it('runs the flush and returns the summary with the correct secret', async () => {
    const res = await post({ authorization: `Bearer ${SECRET}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ sent: 0, failed: 0 })
    expect(runDigestFlush).toHaveBeenCalledTimes(1)
  })

  it('is not behind session auth (no cookie needed) — the secret is the only gate', async () => {
    // A valid secret with no session cookie still works (it is a public route).
    expect((await post({ authorization: `Bearer ${SECRET}` })).statusCode).toBe(200)
  })
})
