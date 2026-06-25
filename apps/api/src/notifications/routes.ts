import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../middleware/errorHandler'
import { runDigestFlush } from './digest'

// Notification routes. The cron endpoint is PUBLIC (no session) but gated by a
// shared CRON_SECRET — it is invoked by an external scheduler (GitHub Actions),
// not a logged-in user. It fails CLOSED: if CRON_SECRET is unset it rejects, so
// a misconfigured deploy never exposes an open flush trigger.

/**
 * POST /api/cron/notify-digest — run the landlord digest flush. Authorized only
 * by `Authorization: Bearer <CRON_SECRET>`. Idempotent: a double-fire finds the
 * already-stamped events and sends nothing more.
 */
async function notifyDigest(request: FastifyRequest, reply: FastifyReply) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    throw new AppError('UNAUTHORIZED', 'Unauthorized', 401)
  }
  const summary = await runDigestFlush(request.server.prisma)
  return reply.send(summary)
}

async function notificationRoutes(fastify: FastifyInstance) {
  // Public + secret-gated; deliberately NOT behind requireAuth.
  fastify.post('/api/cron/notify-digest', notifyDigest)
}

//ESM
export default notificationRoutes
