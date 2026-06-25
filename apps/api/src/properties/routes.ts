import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'

type Params = { id: string }

/**
 * Property management routes (landlord-only). Every route requires auth and is
 * scoped to the session user (the landlord) in the handler — the same
 * ownership-scoped, no-existence-leak pattern as contractors/invoices.
 */
async function propertyRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }

  fastify.post('/api/properties', auth, handlers.createProperty)
  fastify.get('/api/properties', auth, handlers.listProperties)
  fastify.get<{ Params: Params }>('/api/properties/:id', auth, handlers.getProperty)
  fastify.patch<{ Params: Params }>('/api/properties/:id', auth, handlers.updateProperty)
  fastify.delete<{ Params: Params }>('/api/properties/:id', auth, handlers.deleteProperty)
}

//ESM
export default propertyRoutes
