import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

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
  request.log.error(error)

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
