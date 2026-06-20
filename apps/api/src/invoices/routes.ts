import type { FastifyInstance } from 'fastify';
import * as handlers from './handlers';

/**
 * Invoice routes plugin
 * @param {FastifyInstance} fastify  Encapsulated Fastify Instance
 * @param {Object} options plugin options, refer to https://fastify.dev/docs/latest/Reference/Plugins/#plugin-options
 */
async function invoiceRoutes(fastify: FastifyInstance) {
  // POST /api/invoices - Create a new invoice
  fastify.post('/api/invoices', handlers.createInvoice);

  // GET /api/invoices - List invoices with optional filters
  fastify.get('/api/invoices', handlers.listInvoices);

  // GET /api/invoices/:id - Get a single invoice by ID
  fastify.get('/api/invoices/:id', handlers.getInvoice);

  // PATCH /api/invoices/:id - Update an invoice
  fastify.patch('/api/invoices/:id', handlers.updateInvoice);

  // DELETE /api/invoices/:id - Delete an invoice
  fastify.delete('/api/invoices/:id', handlers.deleteInvoice);
}

//ESM
export default invoiceRoutes;
