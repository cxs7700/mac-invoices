import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'

type Params = { id: string }

/**
 * Vendor management routes (landlord-only). Every route requires auth and is
 * scoped to the session user (the landlord) in the handler — the same
 * ownership-scoped, no-existence-leak pattern as invoices.
 */
async function vendorRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }

  fastify.post('/api/vendors', auth, handlers.createVendor)
  fastify.get('/api/vendors', auth, handlers.listVendors)
  fastify.get<{ Params: Params }>('/api/vendors/:id', auth, handlers.getVendor)
  fastify.patch<{ Params: Params }>('/api/vendors/:id', auth, handlers.updateVendor)
  fastify.delete<{ Params: Params }>('/api/vendors/:id', auth, handlers.deleteVendor)
  fastify.get<{ Params: Params }>(
    '/api/vendors/:id/properties',
    auth,
    handlers.listVendorProperties,
  )
  fastify.put<{ Params: Params }>('/api/vendors/:id/properties', auth, handlers.setVendorProperties)
  fastify.post<{ Params: Params }>('/api/vendors/:id/revoke', auth, handlers.revokeLink)
  fastify.post<{ Params: Params }>('/api/vendors/:id/regenerate', auth, handlers.regenerateLink)
}

//ESM
export default vendorRoutes
