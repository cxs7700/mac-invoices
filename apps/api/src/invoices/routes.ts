import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

/**
 * Invoice routes plugin. Every route requires auth and is scoped to the session
 * user (request.user.id) in the handler.
 */
async function invoiceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }

  fastify.post('/api/invoices', auth, handlers.createInvoice)
  fastify.get<{ Querystring: ListInvoicesQuery }>('/api/invoices', auth, handlers.listInvoices)
  fastify.get('/api/invoices/stats', auth, handlers.invoiceStats)
  fastify.get<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.getInvoice)
  fastify.patch<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.updateInvoice)
  fastify.delete<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.deleteInvoice)
}

//ESM
export default invoiceRoutes
