import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { AppError } from '../middleware/errorHandler'
import { parseLinkToken } from '../vendors/token'
import * as handlers from './handlers'
import type { TokenParams } from './handlers'

/**
 * Public (unauthenticated) contractor submission routes — the app's first
 * no-session write path. Authorization is the link token alone; there is NO
 * requireAuth. The plugin registers its own rate limiter keyed by the token's
 * (non-secret) lookupId AND the client IP, so one abusive link or IP cannot
 * exhaust others. Fail closed: a store error blocks rather than waves through.
 */
async function submissionRoutes(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: false,
    skipOnError: false, // fail closed — the limiter is the brute-force backstop
    // Runs at onRequest (before params are parsed), so derive the lookupId from
    // the URL. Only the non-secret lookupId enters the store key — never the secret.
    keyGenerator: (req) => {
      const match = /\/api\/submissions\/([^/?]+)/.exec(req.url)
      const parsed = parseLinkToken(match ? decodeURIComponent(match[1]) : undefined)
      return `${parsed?.lookupId ?? 'anon'}:${req.ip}`
    },
    errorResponseBuilder: () =>
      new AppError('TOO_MANY_REQUESTS', 'Too many requests; please wait a few minutes', 429),
  })

  const submitMax = Number(process.env.SUBMISSION_RATE_LIMIT_MAX ?? 10)
  const uploadMax = Number(process.env.SUBMISSION_UPLOAD_RATE_LIMIT_MAX ?? 20)

  const readMax = Number(process.env.SUBMISSION_READ_RATE_LIMIT_MAX ?? 30)

  fastify.post<{ Params: TokenParams }>(
    '/api/submissions/:token',
    { config: { rateLimit: { max: submitMax, timeWindow: '1 minute' } } },
    handlers.submit,
  )
  fastify.get<{ Params: TokenParams }>(
    '/api/submissions/:token',
    { config: { rateLimit: { max: readMax, timeWindow: '1 minute' } } },
    handlers.listOwn,
  )
  fastify.patch<{ Params: TokenParams & { id: string } }>(
    '/api/submissions/:token/:id',
    { config: { rateLimit: { max: submitMax, timeWindow: '1 minute' } } },
    handlers.edit,
  )
  fastify.post<{ Params: TokenParams & { id: string } }>(
    '/api/submissions/:token/:id/withdraw',
    { config: { rateLimit: { max: submitMax, timeWindow: '1 minute' } } },
    handlers.withdraw,
  )
  // The upload-token route mints Blob write credentials, so it carries its own
  // tighter limit — a stolen link can't flood storage.
  fastify.post<{ Params: TokenParams }>(
    '/api/submissions/:token/upload-token',
    { config: { rateLimit: { max: uploadMax, timeWindow: '15 minutes' } } },
    handlers.createUploadToken,
  )
}

//ESM
export default submissionRoutes
