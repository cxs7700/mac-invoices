import { describe, it, expect, afterAll } from 'vitest'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../src/auth/password'
import {
  createSession,
  validateSessionToken,
  sessionIdFromToken,
  invalidateSession,
} from '../src/auth/session'
import { prisma } from '../src/lib/prisma'

const USER_ID = process.env.LANDLORD_USER_ID ?? 'landlord_seed_user'
const sessionIds: string[] = []

afterAll(async () => {
  for (const id of sessionIds) await invalidateSession(id)
})

describe('password hashing', () => {
  it('verifies a password against its own hash', async () => {
    const hash = await hashPassword('correct horse')
    expect(await verifyPassword(hash, 'correct horse')).toBe(true)
    expect(await verifyPassword(hash, 'wrong')).toBe(false)
  })

  it('returns false (no throw) for a non-argon2 / placeholder hash', async () => {
    expect(await verifyPassword('PLACEHOLDER_SET_IN_PHASE_3', 'anything')).toBe(false)
  })

  it('DUMMY_HASH is a real argon2 hash that never matches', async () => {
    expect(await verifyPassword(DUMMY_HASH, 'anything')).toBe(false)
  })
})

describe('sessions', () => {
  it('stores the sha256 of the token as the id and validates it back to the user', async () => {
    const { token, expiresAt } = await createSession(USER_ID)
    sessionIds.push(sessionIdFromToken(token))

    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    const row = await prisma.session.findUnique({ where: { id: sessionIdFromToken(token) } })
    expect(row).not.toBeNull()
    expect(row!.id).toBe(sessionIdFromToken(token))
    expect(row!.id).not.toBe(token) // the raw token is never stored

    const user = await validateSessionToken(token)
    expect(user?.id).toBe(USER_ID)
  })

  it('returns null for an unknown token', async () => {
    expect(await validateSessionToken('totally-bogus-token')).toBeNull()
  })

  it('rotates: creating a session with a prior token invalidates the old one', async () => {
    const first = await createSession(USER_ID)
    const second = await createSession(USER_ID, first.token)
    sessionIds.push(sessionIdFromToken(second.token))

    expect(await validateSessionToken(first.token)).toBeNull()
    expect((await validateSessionToken(second.token))?.id).toBe(USER_ID)
  })

  it('rejects and deletes an expired session', async () => {
    const { token } = await createSession(USER_ID)
    const id = sessionIdFromToken(token)
    await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await validateSessionToken(token)).toBeNull()
    expect(await prisma.session.findUnique({ where: { id } })).toBeNull()
  })
})
