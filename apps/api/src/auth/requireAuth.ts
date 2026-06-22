import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../middleware/errorHandler'
import { validateSessionToken, type SessionUser } from './session'

export const SESSION_COOKIE = 'session'

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser
  }
}

/** Cookie attributes for the session token (KTD-3). */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    // COOKIE_SECURE is the explicit control (lets staging opt in/out of HTTPS);
    // production additionally fails closed so a forgotten flag never ships the
    // session cookie over plaintext HTTP.
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  }
}

/**
 * preHandler that requires a valid session cookie and injects `request.user`.
 * Replies 401 (UNAUTHORIZED, §7 shape) on a missing/invalid/expired session.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const token = request.cookies?.[SESSION_COOKIE]
  if (!token) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }
  const user = await validateSessionToken(token)
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }
  request.user = user
}
