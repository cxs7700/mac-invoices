import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { requireAuth } from '../auth/requireAuth'
import { AppError } from '../middleware/errorHandler'
import * as handlers from './handlers'
import type { GetInvoiceParams, ImageParams, ListInvoicesQuery } from './types.ts'

/**
 * Invoice routes plugin. Every route requires auth and is scoped to the session
 * user (request.user.id) in the handler.
 */
async function invoiceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: requireAuth }
  // Scoped rate limiting; applied per-route via config.rateLimit (e.g. export).
  // Give the 429 a stable §7 error code so clients can branch on it.
  // The plugin THROWS the builder's return; an AppError renders the §7 shape.
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError('TOO_MANY_REQUESTS', 'Rate limit exceeded; try again later', 429),
  })

  fastify.post('/api/invoices', auth, handlers.createInvoice)
  fastify.get<{ Querystring: ListInvoicesQuery }>('/api/invoices', auth, handlers.listInvoices)
  fastify.get('/api/invoices/stats', auth, handlers.invoiceStats)
  fastify.get<{ Querystring: ListInvoicesQuery }>(
    '/api/invoices/summary',
    auth,
    handlers.invoiceSummary,
  )
  // Sheets export — auth + a modest rate limit so a session can't burn Google quota.
  const exportMax = Number(process.env.EXPORT_RATE_LIMIT_MAX ?? 5)
  fastify.post(
    '/api/invoices/export',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: exportMax, timeWindow: '15 minutes' } },
    },
    handlers.exportInvoices,
  )
  // Continuous Sheets sync flush. PUBLIC + CRON_SECRET-gated (an external
  // scheduler calls it, not a session) — deliberately NOT behind requireAuth.
  fastify.post('/api/cron/sync-sheets', handlers.cronSyncSheets)
  fastify.post('/api/invoices/image-upload-token', auth, handlers.createImageUploadToken)
  fastify.get<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.getInvoice)
  fastify.get<{ Params: GetInvoiceParams }>(
    '/api/invoices/:id/events',
    auth,
    handlers.listInvoiceEvents,
  )
  // Image gallery collection (landlord-only, own-invoice scoped — a vendor 404s).
  fastify.get<{ Params: GetInvoiceParams }>(
    '/api/invoices/:id/images',
    auth,
    handlers.listInvoiceImages,
  )
  fastify.post<{ Params: GetInvoiceParams }>(
    '/api/invoices/:id/images',
    auth,
    handlers.addInvoiceImage,
  )
  fastify.delete<{ Params: ImageParams }>(
    '/api/invoices/:id/images/:imageId',
    auth,
    handlers.removeInvoiceImage,
  )
  fastify.patch<{ Params: ImageParams }>(
    '/api/invoices/:id/images/:imageId',
    auth,
    handlers.setInvoiceImageType,
  )
  fastify.patch<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.updateInvoice)
  fastify.delete<{ Params: GetInvoiceParams }>('/api/invoices/:id', auth, handlers.deleteInvoice)
}

//ESM
export default invoiceRoutes
