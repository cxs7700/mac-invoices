import { describe, it, expect, beforeAll, afterAll } from 'vitest'

process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'
// A small cap so the limit is reachable in a handful of calls. This file gets
// its own app instance, so it cannot affect the behavior tests' counter.
process.env.RESET_RATE_LIMIT_MAX = '2'

import { buildApp } from '../src/app'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('reset-password rate limit', () => {
  it('starts refusing once the cap is exceeded (AE10)', async () => {
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        // Deliberately a junk token: this asserts the LIMITER, and a junk token
        // exercises it without needing a real account. Under the cap it must be
        // the ordinary 400, not a 429.
        payload: { token: 'rst_nope.1.nope', newPassword: 'a-good-password' },
      })

    expect((await call()).statusCode).toBe(400)
    expect((await call()).statusCode).toBe(400)

    const limited = await call()
    expect(limited.statusCode).toBe(429)
    // The app's own envelope, not the plugin's default body.
    expect(limited.json().error.code).toBe('TOO_MANY_REQUESTS')
  })
})
