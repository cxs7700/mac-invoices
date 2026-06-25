import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'

/**
 * Landlord settings routes (authed). Every route requires a session and acts on
 * request.user — no settings response ever returns a secret (the service-account
 * key, a password hash) (R10 / DEC-019).
 */
async function settingsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }

  fastify.patch('/api/settings/profile', auth, handlers.updateProfile)
}

//ESM
export default settingsRoutes
