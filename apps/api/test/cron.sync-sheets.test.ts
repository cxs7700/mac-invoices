import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// Mock the flush — this test is about the CRON_SECRET gate, not flush behavior.
const runSheetsSyncFlush = vi.hoisted(() =>
  vi.fn(async () => ({ users: 0, synced: 0, skipped: 0, failed: 0 })),
)
vi.mock('../src/invoices/sheetSync', () => ({ runSheetsSyncFlush, mirrorUserSheet: vi.fn() }))

import { buildApp } from '../src/app'

const app = buildApp()
const SECRET = 'test-sync-secret'
const post = (headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/cron/sync-sheets', headers })

beforeAll(async () => {
  await app.ready()
})
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
})
afterAll(async () => {
  delete process.env.CRON_SECRET
  await app.close()
})

describe('POST /api/cron/sync-sheets', () => {
  it('401s with no Authorization header and does not run the flush', async () => {
    const res = await post()
    expect(res.statusCode).toBe(401)
    expect(runSheetsSyncFlush).not.toHaveBeenCalled()
  })

  it('401s with a wrong bearer token', async () => {
    const res = await post({ authorization: 'Bearer nope' })
    expect(res.statusCode).toBe(401)
    expect(runSheetsSyncFlush).not.toHaveBeenCalled()
  })

  it('fails closed (401) when CRON_SECRET is unset, even with a bearer', async () => {
    delete process.env.CRON_SECRET
    const res = await post({ authorization: 'Bearer anything' })
    expect(res.statusCode).toBe(401)
    expect(runSheetsSyncFlush).not.toHaveBeenCalled()
  })

  it('runs the flush and returns the summary with the correct secret', async () => {
    const res = await post({ authorization: `Bearer ${SECRET}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ users: 0, synced: 0, skipped: 0, failed: 0 })
    expect(runSheetsSyncFlush).toHaveBeenCalledTimes(1)
  })

  it('is not behind session auth (no cookie needed) — the secret is the only gate', async () => {
    expect((await post({ authorization: `Bearer ${SECRET}` })).statusCode).toBe(200)
  })
})
