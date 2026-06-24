import './lib/loadEnv.ts'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import dbConnector from './db/connector'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import authRoutes from './auth/routes'
import healthRoutes from './routes/health'
import invoiceRoutes from './invoices/routes'
import contractorRoutes from './contractors/routes'

/** Cap request bodies well above any real invoice JSON (~100x headroom). */
export const BODY_LIMIT_BYTES = 64 * 1024 // 64 KB

/**
 * Logger config with secret redaction. The default Fastify request serializer
 * does not log headers, but this neutralizes any future code (or the central
 * errorHandler's `request.log.error`) that might surface the session cookie or
 * an authorization header. Redaction happens at the pino serializer layer, so
 * it holds regardless of what is logged.
 */
export const loggerOptions = {
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      'headers.cookie',
      'headers.authorization',
    ],
    censor: '[Redacted]',
  },
}

/**
 * Construct the Fastify app: register plugins and routes, return the instance
 * without listening. Lets tests use `app.inject()` without binding a port.
 * Registration is deferred by Fastify until `.ready()` / `.listen()` / `.inject()`.
 */
export function buildApp() {
  const app = Fastify({ logger: loggerOptions, bodyLimit: BODY_LIMIT_BYTES })

  // Error handling (registered before routes so thrown errors are caught)
  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)

  // Security headers. The Fastify function serves JSON under /api only (the SPA
  // is static on Vercel), so a strict resource CSP buys nothing — use a minimal
  // `default-src 'none'` policy and deny framing outright. HSTS stays on (a
  // no-op over plain http, so it is safe on localhost).
  app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    frameguard: { action: 'deny' },
  })

  // Plugins
  app.register(cookie)
  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })
  app.register(dbConnector)

  // Routes
  app.register(healthRoutes)
  app.register(authRoutes)
  app.register(invoiceRoutes)
  app.register(contractorRoutes)

  return app
}
