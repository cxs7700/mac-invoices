import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import { assertCronSecret } from '../lib/cronAuth'
import { runDigestFlush } from './digest'
import { listFeed, markSeen } from './feed'

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
  assertCronSecret(request)
  const summary = await runDigestFlush(request.server.prisma, request.log)
  return reply.send(summary)
}

async function notificationRoutes(fastify: FastifyInstance) {
  // Public + secret-gated; deliberately NOT behind requireAuth.
  fastify.post('/api/cron/notify-digest', notifyDigest)

  // In-app feed (authed): the landlord's own vendor-activity notifications.
  const auth = { preHandler: requireAuth }
  fastify.get('/api/notifications', auth, listFeed)
  fastify.post('/api/notifications/seen', auth, markSeen)
}

//ESM
export default notificationRoutes
