import type { FastifyInstance, FastifyPluginCallback } from 'fastify'
import type { GetInvoiceParams, Invoice } from './myTypes'
import * as z from 'zod'

export const myRoutes: FastifyPluginCallback = (fastify: FastifyInstance, _options, done) => {
  fastify.get('/api/invoices', async (_request, reply) => {
    const invoices = await fastify.prisma.invoice.findMany()

    if (!invoices || invoices.length === 0) {
      reply.status(404)
      return { message: '🦆 No invoices found.' }
    } else {
      return { invoices, message: 'We found our invoices!' }
    }
  })

  fastify.post('/api/invoices', async (request, _reply) => {
    const body = request.body as Invoice
    const res = await fastify.prisma.invoice.create({
      data: {
        // description: "job",
        // date: new Date(),
        // location: '',
        // price: '',
        // status: '',
        // number: 10,
        // quantity: 1,
        // creatorId: 2
        ...body,
      },
    })
    return res
  })

  fastify.get('/api/invoices/:id', async (request, _reply) => {
    const { id } = request.params as GetInvoiceParams
    const invoiceId = z.coerce.number().parse(id)
    const res = await fastify.prisma.invoice.findUnique({
      where: { id: invoiceId },
    })
    return res
  })

  fastify.patch('/api/invoices/:id', async (request, _reply) => {
    const { id } = request.params as GetInvoiceParams
    const invoiceId = z.coerce.number().parse(id)
    const body = request.body as Invoice
    const res = await fastify.prisma.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        ...body,
      },
    })
    return res
  })

  fastify.delete('/api/invoices/:id', async (request, _reply) => {
    const { id } = request.params as GetInvoiceParams
    const invoiceId = z.coerce.number().parse(id)
    const res = await fastify.prisma.invoice.delete({
      where: { id: invoiceId },
    })
    return res
  })

  done()
}

// ESM
export default myRoutes
