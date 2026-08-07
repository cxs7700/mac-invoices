import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { LoginSchema, SignupSchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { verifyPassword, hashPassword, DUMMY_HASH } from './password'
import { assertValidInviteCode } from './inviteCode'
import { createSession, invalidateSession, sessionIdFromToken } from './session'
import { requireAuth, sessionCookieOptions, SESSION_COOKIE } from './requireAuth'

async function authRoutes(app: FastifyInstance) {
  // Scoped rate limiting; applied per-route via config.rateLimit below. Match
  // settings/routes.ts and submissions/routes.ts: without an
  // errorResponseBuilder, a 429 here returns the plugin's default body instead
  // of the app's { error: { code, message } } envelope.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError('TOO_MANY_REQUESTS', 'Too many attempts; try again later', 429),
  })

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { email, password } = parseBody(LoginSchema, request.body)

      const user = await request.server.prisma.user.findUnique({ where: { email } })
      if (!user) {
        // Equalize timing with the wrong-password path so unknown emails aren't
        // distinguishable by response time (no user enumeration).
        await verifyPassword(DUMMY_HASH, password)
        throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401)
      }

      const ok = await verifyPassword(user.passwordHash, password)
      if (!ok) {
        throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401)
      }

      // Rotate any existing session on the incoming cookie (fixation prevention).
      const { token, expiresAt } = await createSession(user.id, request.cookies?.[SESSION_COOKIE])
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        locale: user.locale,
      })
    },
  )

  app.post(
    '/api/auth/signup',
    // Far tighter than login (10/15min): this is an unauthenticated endpoint
    // that creates tenant rows, not just a credential check.
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { inviteCode, email, password, firstName, lastName } = parseBody(
        SignupSchema,
        request.body,
      )

      // Gate first: an unconfigured or wrong code must never touch the DB.
      assertValidInviteCode(inviteCode)

      const existing = await request.server.prisma.user.findUnique({ where: { email } })
      if (existing) {
        // Deliberately specific (not folded into a generic failure) so the
        // visitor knows to log in instead of retrying. This is user
        // enumeration, but only for a caller who already holds a valid invite
        // code and has cleared the hourly limit. Login itself stays
        // non-enumerating (DEC-018's constant-time dummy verify).
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409)
      }

      const passwordHash = await hashPassword(password)

      // `name` is kept in sync with the split fields on every write (DEC-028) —
      // the PDF Bill-To block and the ledger actor names read it.
      // A concurrent signup racing the check above surfaces as P2002, which the
      // central error handler already renders as 409 CONFLICT.
      const user = await request.server.prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`,
          role: 'LANDLORD',
        },
      })

      const { token, expiresAt } = await createSession(user.id, request.cookies?.[SESSION_COOKIE])
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))

      return reply.code(201).send({
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        locale: user.locale,
      })
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE]
    if (token) {
      await invalidateSession(sessionIdFromToken(token))
    }
    // Match the attributes the cookie was set with so strict browsers honor the
    // deletion (RFC 6265 matches on name + path; mismatches can be ignored).
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    })
    return reply.code(204).send()
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return request.user
  })
}

export default authRoutes
