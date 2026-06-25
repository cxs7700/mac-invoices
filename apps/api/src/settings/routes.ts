import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { requireAuth } from '../auth/requireAuth'
import { AppError } from '../middleware/errorHandler'
import * as handlers from './handlers'

/**
 * Landlord settings routes (authed). Every route requires a session and acts on
 * request.user — no settings response ever returns a secret (the service-account
 * key, a password hash) (R10 / DEC-019).
 */
async function settingsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }
  // Scoped rate limiting (the password route caps brute-force re-auth attempts).
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError('TOO_MANY_REQUESTS', 'Too many attempts; try again later', 429),
  })
  const pwMax = Number(process.env.PASSWORD_RATE_LIMIT_MAX ?? 10)

  fastify.patch('/api/settings/profile', auth, handlers.updateProfile)
  fastify.post(
    '/api/settings/password',
    { preHandler: requireAuth, config: { rateLimit: { max: pwMax, timeWindow: '15 minutes' } } },
    handlers.changePassword,
  )
  fastify.get('/api/settings/sheets', auth, handlers.getSheets)
  fastify.patch('/api/settings/sheets', auth, handlers.saveSheet)
  fastify.post('/api/settings/sheets/test', auth, handlers.testSheet)
}

//ESM
export default settingsRoutes
