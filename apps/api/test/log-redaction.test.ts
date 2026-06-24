import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { loggerOptions } from '../src/app'

// Drive the EXACT logger config buildApp() uses through a capture stream, so we
// prove redaction is wired — not just that some pino instance can redact.
function capture() {
  const lines: string[] = []
  const stream = { write: (s: string) => lines.push(s) }
  const logger = pino(loggerOptions, stream)
  return { logger, lines }
}

describe('logger redaction (loggerOptions)', () => {
  it('redacts the contractor link-token secret from the request URL', () => {
    const { logger, lines } = capture()
    logger.info(
      { req: { method: 'POST', url: '/api/submissions/inv_ab12cd34_THE-SECRET_part/upload-token' } },
      'incoming',
    )
    const out = lines.join('')
    expect(out).not.toContain('THE-SECRET') // the secret never appears
    expect(out).toContain('inv_ab12cd34_[REDACTED]') // lookupId kept, secret scrubbed
  })

  it('does not log request header secrets (the req serializer drops headers)', () => {
    const { logger, lines } = capture()
    logger.info(
      { req: { method: 'GET', url: '/api/x', headers: { cookie: 'session=SECRET-COOKIE' } } },
      'incoming',
    )
    expect(lines.join('')).not.toContain('SECRET-COOKIE')
  })

  it('redacts top-level cookie + authorization headers', () => {
    const { logger, lines } = capture()
    logger.info({ headers: { cookie: 'session=SECRET-COOKIE', authorization: 'Bearer SECRET-TOKEN' } }, 'x')
    const out = lines.join('')
    expect(out).not.toContain('SECRET-COOKIE')
    expect(out).not.toContain('SECRET-TOKEN')
    expect(out).toContain('[Redacted]')
  })

  it('redacts a response set-cookie header', () => {
    const { logger, lines } = capture()
    logger.info({ res: { headers: { 'set-cookie': 'session=SECRET-SET' } } }, 'outgoing')
    expect(lines.join('')).not.toContain('SECRET-SET')
  })
})
