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
  it('redacts request cookie + authorization headers', () => {
    const { logger, lines } = capture()
    logger.info(
      { req: { headers: { cookie: 'session=SECRET-COOKIE', authorization: 'Bearer SECRET-TOKEN' } } },
      'incoming',
    )
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
