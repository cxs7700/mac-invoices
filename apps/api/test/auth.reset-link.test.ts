import { describe, it, expect, beforeAll, afterAll } from 'vitest'

process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'
import { resetLinkFor } from '../src/auth/resetLink'
import { parseResetToken, resetTokenMatches } from '../src/auth/resetToken'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

const ORIGIN = 'https://mac-invoices.vercel.app'

describe('resetLinkFor', () => {
  it('issues a link whose token verifies against the account', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = (await resetLinkFor(app.prisma, u.user.email, ORIGIN))!
      expect(issued).not.toBeNull()
      expect(issued.url.startsWith(`${ORIGIN}/reset-password#t=rst_`)).toBe(true)
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now())

      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true, passwordResetVersion: true },
      })
      const parsed = parseResetToken(issued.url.split('#t=')[1])!
      expect(parsed.userId).toBe(u.user.id)
      expect(resetTokenMatches(parsed, row.passwordHash, row.passwordResetVersion)).toBe(true)
      // Issuing bumped the version — the mechanism that retires an older,
      // unconsumed link on re-issue (R8).
      expect(row.passwordResetVersion).toBe(1)
    } finally {
      await u.cleanup()
    }
  })

  it('matches the account regardless of the email casing typed', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = await resetLinkFor(app.prisma, `  ${u.user.email.toUpperCase()} `, ORIGIN)
      expect(issued).not.toBeNull()
    } finally {
      await u.cleanup()
    }
  })

  // Unlike the public endpoint, this DOES distinguish — the caller is the
  // operator at a terminal, and a silent success would have them send a link
  // that can never work.
  it('returns null for an unknown account', async () => {
    expect(await resetLinkFor(app.prisma, 'nobody-here@example.com', ORIGIN)).toBeNull()
  })

  it('never exposes the password hash or the signing key (AE9)', async () => {
    const u = await createSecondUser(app)
    try {
      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const issued = (await resetLinkFor(app.prisma, u.user.email, ORIGIN))!
      const printed = `${issued.url} ${issued.expiresAt.toISOString()}`
      expect(printed).not.toContain(row.passwordHash)
      expect(printed).not.toContain(process.env.RESET_LINK_KEY!)
    } finally {
      await u.cleanup()
    }
  })

  it('does not double a trailing slash on the origin', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = (await resetLinkFor(app.prisma, u.user.email, `${ORIGIN}/`))!
      expect(issued.url).toContain(`${ORIGIN}/reset-password#t=`)
      expect(issued.url).not.toContain('//reset-password')
    } finally {
      await u.cleanup()
    }
  })
})
