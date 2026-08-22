import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { logEvent } from '../lib/log'

/** How many stack frames are worth keeping to locate a fault. */
const STACK_FRAMES = 8

/**
 * The stack's FRAMES, without its first line.
 *
 * That first line is `<Name>: <message>`, and error messages are the one part of
 * an error we must not log: Prisma's validation and query errors embed the
 * offending arguments, which for this app means vendor names, emails, phone
 * numbers and invoice amounts. The frames alone locate the fault, which is what
 * the message was being read for anyway. The message still reaches the caller in
 * the response body — that goes to the person who made the request, not to a
 * shared log drain.
 */
export function stackFrames(error: unknown): string | undefined {
  const stack = (error as { stack?: unknown })?.stack
  if (typeof stack !== 'string') return undefined
  const frames = stack
    .split('\n')
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, STACK_FRAMES)
    .map((line) => line.trim())
  return frames.length > 0 ? frames.join(' | ') : undefined
}

/**
 * Log a failed request as a structured event.
 *
 * Client errors (4xx) are `warn` and carry only their stable code — they are
 * routine and a stack adds nothing. Server errors (5xx) are `error` and carry
 * stack frames, because someone will need to find them.
 */
function logRequestError(error: unknown, request: FastifyRequest): void {
  const status = (error as { statusCode?: unknown })?.statusCode
  const statusCode = typeof status === 'number' ? status : 500
  const code = (error as { code?: unknown })?.code
  const name = (error as { name?: unknown })?.name

  if (statusCode >= 400 && statusCode < 500) {
    logEvent(request.log, 'warn', {
      event: 'request.client_error',
      outcome: 'denied',
      statusCode,
      code: typeof code === 'string' ? code : typeof name === 'string' ? name : undefined,
    })
    return
  }

  logEvent(request.log, 'error', {
    event: 'request.server_error',
    outcome: 'failed',
    statusCode,
    code: typeof code === 'string' ? code : typeof name === 'string' ? name : undefined,
  })
  // Frames go on their own line: `logEvent`'s allow-list has no `stack` key, by
  // design — it must stay a list of small, opaque values.
  const frames = stackFrames(error)
  if (frames) request.log.error({ event: 'request.server_error.stack', frames }, 'stack')
}

/**
 * Application error carrying a stable client-facing code + HTTP status.
 * Handlers throw these; the central errorHandler renders the §7 error shape.
 */
export class AppError extends Error {
  code: string
  statusCode: number
  details?: unknown

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

/** Prisma known-request errors carry a string `code` like "P2002". */
function prismaCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && /^P\d+$/.test(code)) return code
  }
  return undefined
}

type ErrorBody = { error: { code: string; message: string; details?: unknown } }

function body(code: string, message: string, details?: unknown): ErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } }
}

/**
 * Central error handler — the single place that renders error responses in the
 * §7 shape `{ error: { code, message, details? } }`. Never leaks stack traces.
 */
export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  logRequestError(error, request)

  if (error instanceof AppError) {
    return reply.code(error.statusCode).send(body(error.code, error.message, error.details))
  }

  const fe = error as FastifyError

  // Schema validation failures
  if (fe?.validation) {
    return reply.code(400).send(body('VALIDATION_ERROR', fe.message, fe.validation))
  }

  // Prisma known-request errors (mirrors the codes the handlers used to map)
  const pc = prismaCode(error)
  if (pc === 'P2002') {
    return reply.code(409).send(body('CONFLICT', 'A record with this value already exists'))
  }
  if (pc === 'P2025') {
    return reply.code(404).send(body('NOT_FOUND', 'Resource not found'))
  }
  if (pc === 'P2003') {
    // Foreign-key violation — a referenced record does not exist (client error).
    return reply.code(400).send(body('BAD_REFERENCE', 'A referenced record does not exist'))
  }

  // Request body exceeded the configured bodyLimit — give it a stable code
  // instead of leaking the raw framework code (FST_ERR_CTP_BODY_TOO_LARGE).
  // The statusCode===413 arm is an intentional catch-all so no 413 ever falls
  // through to the generic branch and leaks a framework code; nothing in this
  // app throws a 413 with different semantics (AppError/Prisma are matched above).
  if (fe?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fe?.statusCode === 413) {
    return reply.code(413).send(body('PAYLOAD_TOO_LARGE', 'Request body too large'))
  }

  // Other client errors that arrive with a 4xx status
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    return reply.code(fe.statusCode).send(body(fe.code ?? 'BAD_REQUEST', fe.message))
  }

  // Unknown → 500, generic message (real detail is in the logs above)
  return reply.code(500).send(body('INTERNAL_ERROR', 'Internal server error'))
}

/** Not-found handler so unmatched routes also return the standard shape. */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  reply.code(404).send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`))
}
