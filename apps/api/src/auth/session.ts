import { sha256 } from '@oslojs/crypto/sha2'
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding'
import { prisma } from '../lib/prisma'

// Fixed 30-day session lifetime, no sliding renewal (KTD-1) — caps a stolen
// token's life without needing a createdAt column / migration.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export type SessionUser = {
  id: string
  email: string
  name: string | null
  firstName: string | null
  lastName: string | null
  role: string
  locale: string
}

/** A random opaque token (the cookie value). */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return encodeBase32LowerCaseNoPadding(bytes)
}

/** The Session.id stored in the DB — the token's SHA-256, never the token itself. */
export function sessionIdFromToken(token: string): string {
  return encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
}

/**
 * Create a session for `userId`. If a prior cookie token is supplied, its session
 * is invalidated first (rotation — session-fixation prevention, KTD-1).
 */
export async function createSession(
  userId: string,
  priorToken?: string,
): Promise<{ token: string; expiresAt: Date }> {
  if (priorToken) {
    await invalidateSession(sessionIdFromToken(priorToken))
  }
  const token = generateSessionToken()
  const id = sessionIdFromToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { id, userId, expiresAt } })
  return { token, expiresAt }
}

/** Validate a cookie token; returns the session user, or null if absent/expired. */
export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  const id = sessionIdFromToken(token)
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          role: true,
          locale: true,
        },
      },
    },
  })
  if (!session) return null
  if (Date.now() >= session.expiresAt.getTime()) {
    await invalidateSession(id)
    return null
  }
  return session.user
}

/** Delete a session by id (idempotent). */
export async function invalidateSession(id: string): Promise<void> {
  await prisma.session.delete({ where: { id } }).catch(() => {})
}
