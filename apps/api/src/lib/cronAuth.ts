import type { FastifyRequest } from 'fastify'
import { AppError } from '../middleware/errorHandler'

// Shared gate for the public cron endpoints (digest flush, Sheets sync). They
// carry no session — an external scheduler (GitHub Actions) calls them with a
// shared secret. Fails CLOSED: if CRON_SECRET is unset the request is rejected,
// so a misconfigured deploy never exposes an open flush trigger.
export function assertCronSecret(request: FastifyRequest): void {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) {
    throw new AppError('UNAUTHORIZED', 'Unauthorized', 401)
  }
}
