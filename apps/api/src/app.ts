import './lib/loadEnv.ts'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyServerOptions } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import dbConnector from './db/connector'
import { resolveLogLevel } from './lib/log'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import authRoutes from './auth/routes'
import healthRoutes from './routes/health'
import invoiceRoutes from './invoices/routes'
import vendorRoutes from './vendors/routes'
import propertyRoutes from './properties/routes'
import submissionRoutes from './submissions/routes'
import settingsRoutes from './settings/routes'
import notificationRoutes from './notifications/routes'

/** Cap request bodies well above any real invoice JSON (~100x headroom). */
export const BODY_LIMIT_BYTES = 64 * 1024 // 64 KB

/**
 * Strip the vendor link token's SECRET from a logged URL. The token rides in
 * the request path (`/api/submissions/inv_<lookupId>_<secret>/…`) — a bearer
 * credential that `redact.paths` (header-only) does not cover — so without this
 * the plaintext secret lands in the request log and a log reader could replay a
 * live link. The non-secret `lookupId` is kept for traceability; only the secret
 * after it is redacted.
 */
export function redactUrlToken(url: string): string {
  return url.replace(/(inv_[0-9a-f]+_)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
}

type LoggedReq = {
  method?: string
  url?: string
  host?: string
  hostname?: string
  ip?: string
  headers?: Record<string, unknown>
}

/**
 * Only the status is read. Declaring nothing else is deliberate — Fastify's
 * reply exposes `headers` as a METHOD, so a `headers` property here both fails
 * to typecheck and derails the server's generic inference.
 */
type LoggedRes = { statusCode?: number }

/**
 * Correlate our lines with the platform's. Vercel stamps every invocation with
 * `x-vercel-id`; a proxy or a caller may send `x-request-id`. Reusing the
 * inbound id (rather than Fastify's per-process counter, which restarts at 1 in
 * every serverless instance and so collides constantly) makes a Vercel log entry
 * and our application events joinable. Falls back to a random id.
 *
 * The header is attacker-controlled on a public route, so it is capped and
 * stripped to a safe charset — an id is echoed into every log line for the
 * request, and unbounded caller-supplied text there is a log-injection vector.
 */
export function requestIdFrom(headers: Record<string, unknown>): string {
  for (const name of ['x-request-id', 'x-vercel-id']) {
    const raw = headers[name]
    if (typeof raw === 'string') {
      const safe = raw.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 64)
      if (safe) return safe
    }
  }
  return randomUUID()
}

/**
 * Logger config with secret redaction. `redact.paths` neutralizes the session
 * cookie / authorization header in any logged headers; a custom `req` serializer
 * additionally scrubs the link-token secret out of the request URL (the default
 * serializer logs `url` verbatim). Redaction happens at the pino serializer
 * layer, so it holds regardless of what is logged.
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
  serializers: {
    req(req: LoggedReq) {
      return {
        method: req.method,
        url: typeof req.url === 'string' ? redactUrlToken(req.url) : req.url,
        host: req.host ?? req.hostname ?? (req.headers?.host as string | undefined),
        remoteAddress: req.ip,
      }
    },
    /**
     * Reduce a response to its status. pino's default `res` serializer reaches
     * for the outgoing headers, which on this app include the session `Set-Cookie`
     * — `redact.paths` covers the shape it emits today, but a serializer that
     * emits only the status cannot leak a header at all, whatever pino changes.
     */
    res(res: LoggedRes) {
      return { statusCode: res.statusCode }
    },
  },
}

/**
 * Construct the Fastify app: register plugins and routes, return the instance
 * without listening. Lets tests use `app.inject()` without binding a port.
 * Registration is deferred by Fastify until `.ready()` / `.listen()` / `.inject()`.
 *
 * `opts.loggerInstance` supplies a ready-made pino instance instead of the
 * default config. Its only caller is the PII test, which passes one writing to
 * an in-memory stream so it can assert on every line the app actually emits.
 * Production passes nothing.
 */
export function buildApp(opts: { loggerInstance?: FastifyServerOptions['loggerInstance'] } = {}) {
  // The level is composed here rather than baked into `loggerOptions` so that
  // module stays a pure redaction/serializer config — the redaction tests drive
  // it through their own pino instance and must not be silenced by NODE_ENV=test.
  // A caller-supplied instance replaces both (Fastify rejects the two together).
  const loggerOpts = opts.loggerInstance
    ? { loggerInstance: opts.loggerInstance }
    : { logger: { ...loggerOptions, level: resolveLogLevel(process.env) } }

  const app = Fastify({
    ...loggerOpts,
    bodyLimit: BODY_LIMIT_BYTES,
    // trustProxy: behind Vercel's edge proxy, request.ip must be the real client
    // (from x-forwarded-for) so the public-submission per-IP rate limit keys on
    // the caller, not the shared proxy address (KTD-5).
    trustProxy: true,
    genReqId: (req) => requestIdFrom(req.headers as Record<string, unknown>),
  })

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
    // The vendor link carries its bearer token in the URL. no-referrer keeps
    // that token out of the Referer header on any cross-origin request the
    // vendor page makes (e.g. loading a signed Blob photo URL), so it never
    // leaks to a third-party CDN's access logs (R-3).
    referrerPolicy: { policy: 'no-referrer' },
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
  app.register(vendorRoutes)
  app.register(propertyRoutes)
  app.register(submissionRoutes)
  app.register(settingsRoutes)
  app.register(notificationRoutes)

  return app
}
