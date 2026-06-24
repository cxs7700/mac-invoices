import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'

type Params = { id: string }

/**
 * Contractor management routes (landlord-only). Every route requires auth and is
 * scoped to the session user (the landlord) in the handler — the same
 * ownership-scoped, no-existence-leak pattern as invoices.
 */
async function contractorRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }

  fastify.post('/api/contractors', auth, handlers.createContractor)
  fastify.get('/api/contractors', auth, handlers.listContractors)
  fastify.get<{ Params: Params }>('/api/contractors/:id', auth, handlers.getContractor)
  fastify.patch<{ Params: Params }>('/api/contractors/:id', auth, handlers.updateContractor)
  fastify.post<{ Params: Params }>('/api/contractors/:id/revoke', auth, handlers.revokeLink)
  fastify.post<{ Params: Params }>('/api/contractors/:id/regenerate', auth, handlers.regenerateLink)
}

//ESM
export default contractorRoutes
