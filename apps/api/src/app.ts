import Fastify from 'fastify'
import dbConnector from './db/connector'
import healthRoutes from './routes/health'
import invoiceRoutes from './invoices/routes'

/**
 * Construct the Fastify app: register plugins and routes, return the instance
 * without listening. Lets tests use `app.inject()` without binding a port.
 * Registration is deferred by Fastify until `.ready()` / `.listen()` / `.inject()`.
 */
export function buildApp() {
  const app = Fastify({ logger: true })

  // Plugins
  app.register(dbConnector)

  // Routes
  app.register(healthRoutes)
  app.register(invoiceRoutes)

  return app
}
