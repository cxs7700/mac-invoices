import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { LoginSchema } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { verifyPassword, DUMMY_HASH } from './password'
import { createSession, invalidateSession, sessionIdFromToken } from './session'
import { requireAuth, sessionCookieOptions, SESSION_COOKIE } from './requireAuth'

async function authRoutes(app: FastifyInstance) {
  // Scoped rate limiting; applied per-route via config.rateLimit below.
  await app.register(rateLimit, { global: false })

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
