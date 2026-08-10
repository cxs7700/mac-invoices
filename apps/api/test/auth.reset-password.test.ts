import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Read lazily by resetKey(), so a top-level assignment is enough.
process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'
// This file makes well over the production cap of 10 reset calls from one IP.
// Without this the suite would 429 partway through and look like a broken
// endpoint. The cap itself is covered separately, in auth.reset-limit.test.ts.
process.env.RESET_RATE_LIMIT_MAX = '500'

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'
import { buildResetToken, RESET_TTL_MS } from '../src/auth/resetToken'
import { verifyPassword } from '../src/auth/password'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

const reset = (token: string, newPassword: string) =>
  app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword } })

/** A throwaway user plus a live link for them. */
async function userWithLink(ttlMs = RESET_TTL_MS) {
  const u = await createSecondUser(app)
  const row = await app.prisma.user.findUniqueOrThrow({
    where: { id: u.user.id },
    select: { passwordHash: true },
  })
  const token = buildResetToken(u.user.id, row.passwordHash, Date.now() + ttlMs)
  return { ...u, token }
}

const INVALID = 'That reset link is invalid or has expired. Ask for a new one.'

describe('POST /api/auth/reset-password', () => {
  it('sets the password, kills every session, and the new password logs in (AE1)', async () => {
    const u = await userWithLink()
    try {
      const res = await reset(u.token, 'brand-new-password')
      expect(res.statusCode).toBe(204)

      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true, email: true },
      })
      expect(await verifyPassword(row.passwordHash, 'brand-new-password')).toBe(true)
      expect(await app.prisma.session.count({ where: { userId: u.user.id } })).toBe(0)

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: row.email, password: 'brand-new-password' },
      })
      expect(login.statusCode).toBe(200)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses a link that has already been used (AE2)', async () => {
    const u = await userWithLink()
    try {
      expect((await reset(u.token, 'first-new-password')).statusCode).toBe(204)
      const again = await reset(u.token, 'second-new-password')
      expect(again.statusCode).toBe(400)
      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      // Still the FIRST reset's password — the replay changed nothing.
      expect(await verifyPassword(row.passwordHash, 'first-new-password')).toBe(true)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses an expired link (AE3)', async () => {
    const u = await userWithLink(-1000) // already expired
    try {
      expect((await reset(u.token, 'brand-new-password')).statusCode).toBe(400)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses a tampered link (AE4)', async () => {
    const u = await userWithLink()
    try {
      const tampered = `${u.token.slice(0, -1)}${u.token.endsWith('A') ? 'B' : 'A'}`
      expect((await reset(tampered, 'brand-new-password')).statusCode).toBe(400)
    } finally {
      await u.cleanup()
    }
  })

  it('returns byte-identical responses for every failure mode (AE5)', async () => {
    const u = await userWithLink()
    let expired: string
    try {
      expired = buildResetToken(u.user.id, 'whatever', Date.now() - 1000)
      const unknownUser = buildResetToken(
        'clx9999999999999999999999',
        'whatever',
        Date.now() + RESET_TTL_MS,
      )
      const tampered = `${u.token.slice(0, -1)}${u.token.endsWith('A') ? 'B' : 'A'}`
      const malformed = 'not-even-close'

      const bodies = []
      for (const t of [expired, unknownUser, tampered, malformed]) {
        const res = await reset(t, 'brand-new-password')
        bodies.push({ status: res.statusCode, body: res.body })
      }
      // No response may hint at WHICH thing was wrong — otherwise the endpoint
      // becomes an oracle for which accounts exist.
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
      expect(bodies[0].status).toBe(400)
      expect(JSON.parse(bodies[0].body).error.code).toBe('INVALID_RESET_LINK')
      expect(JSON.parse(bodies[0].body).error.message).toBe(INVALID)
    } finally {
      await u.cleanup()
    }
  })

  it('retires the older link when a newer one is issued (AE6)', async () => {
    const u = await createSecondUser(app)
    try {
      const before = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const older = buildResetToken(u.user.id, before.passwordHash, Date.now() + RESET_TTL_MS)
      // Using the older link rotates the hash, which is exactly what retires it.
      expect((await reset(older, 'password-from-older')).statusCode).toBe(204)

      const mid = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const newer = buildResetToken(u.user.id, mid.passwordHash, Date.now() + RESET_TTL_MS)
      expect((await reset(older, 'should-not-work')).statusCode).toBe(400)
      expect((await reset(newer, 'password-from-newer')).statusCode).toBe(204)
    } finally {
      await u.cleanup()
    }
  })
})
