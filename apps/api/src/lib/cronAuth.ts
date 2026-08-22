import type { FastifyRequest } from 'fastify'
import { AppError } from '../middleware/errorHandler'
import { logEvent } from './log'

// Shared gate for the public cron endpoints (digest flush, Sheets sync). They
// carry no session — an external scheduler (GitHub Actions) calls them with a
// shared secret. Fails CLOSED: if CRON_SECRET is unset the request is rejected,
// so a misconfigured deploy never exposes an open flush trigger.
export function assertCronSecret(request: FastifyRequest): void {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    // `unconfigured` vs `bad_secret` matters to an operator: the first is a
    // deploy that forgot the env var (so the cron silently never runs), the
    // second is someone probing the endpoint. The response is identical either way.
    logEvent(request.log, 'warn', {
      event: 'cron.auth',
      outcome: 'denied',
      reason: secret ? 'bad_secret' : 'unconfigured',
    })
    throw new AppError('UNAUTHORIZED', 'Unauthorized', 401)
  }
}
