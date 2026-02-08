// ESM
import Fastify from 'fastify'
import dbConnector from './db/connector'
import invoiceRoutes from './invoices/myRoutes'

/**
 * @type {import('fastify').FastifyInstance} Instance of Fastify
 */
const fastify = Fastify({
  logger: true
})

// Register plugins in order - dbConnector must be registered first
await fastify.register(dbConnector)
await fastify.register(invoiceRoutes)

fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err)
    process.exit(1)
  }
})