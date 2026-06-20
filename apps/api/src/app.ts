import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import dbConnector from './db/connector'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import healthRoutes from './routes/health'
import invoiceRoutes from './invoices/routes'

/**
 * Construct the Fastify app: register plugins and routes, return the instance
 * without listening. Lets tests use `app.inject()` without binding a port.
 * Registration is deferred by Fastify until `.ready()` / `.listen()` / `.inject()`.
 */
export function buildApp() {
  const app = Fastify({ logger: true })

  // Error handling (registered before routes so thrown errors are caught)
  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)

  // Plugins
  app.register(cookie)
  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })
  app.register(dbConnector)

  // Routes
  app.register(healthRoutes)
  app.register(invoiceRoutes)

  return app
}
