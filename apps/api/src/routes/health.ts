import type { FastifyInstance } from 'fastify'

/**
 * Health route plugin. Liveness only — readiness/DB-ping is deferred (see the
 * Phase 1 plan, Open Questions OQ-2).
 */
async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ status: 'ok' }))
}

export default healthRoutes
