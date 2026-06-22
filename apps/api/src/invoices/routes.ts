import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { requireAuth } from '../auth/requireAuth'
import * as handlers from './handlers'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

/**
 * Invoice routes plugin. Every route requires auth and is scoped to the session
 * user (request.user.id) in the handler.
 */
async function invoiceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }
  // Scoped rate limiting; applied per-route via config.rateLimit (e.g. export).
  await fastify.register(rateLimit, { global: false })

  fastify.post('/api/invoices', auth, handlers.createInvoice)
  fastify.get<{ Querystring: ListInvoicesQuery }>('/api/invoices', auth, handlers.listInvoices)
  fastify.get('/api/invoices/stats', auth, handlers.invoiceStats)
  // Sheets export — auth + a modest rate limit so a session can't burn Google quota.
  const exportMax = Number(process.env.EXPORT_RATE_LIMIT_MAX ?? 5)
  fastify.post(
    '/api/invoices/export',
    { preHandler: requireAuth, config: { rateLimit: { max: exportMax, timeWindow: '15 minutes' } } },
    handlers.exportInvoices,
  )
  fastify.get<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.getInvoice)
  fastify.patch<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.updateInvoice)
  fastify.delete<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.deleteInvoice)
}

//ESM
export default invoiceRoutes
