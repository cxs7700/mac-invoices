import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { logEvent, LOG_FIELD_KEYS, resolveLogLevel } from '../src/lib/log'

// The event logger's whole job is to be PII-safe by construction: an allow-list
// of opaque, non-identifying field names, enforced at RUNTIME so a spread or a
// non-literal object can't smuggle a vendor's email past the type checker.

function capture() {
  const lines: string[] = []
  const logger = pino({ level: 'debug' }, { write: (s: string) => lines.push(s) })
  const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  return { logger, parsed }
}

describe('logEvent', () => {
  it('emits the event name as the pino message and keeps allowed fields', () => {
    const { logger, parsed } = capture()
    logEvent(logger, 'info', { event: 'auth.login', outcome: 'ok', userId: 'usr_abc' })
    const [line] = parsed()
    expect(line.msg).toBe('auth.login')
    expect(line.event).toBe('auth.login')
    expect(line.outcome).toBe('ok')
    expect(line.userId).toBe('usr_abc')
  })

  it('drops any field outside the allow-list, even when types are bypassed', () => {
    const { logger, parsed } = capture()
    // Cast models the real leak: an object assembled elsewhere and spread in.
    const smuggled = {
      event: 'auth.login',
      email: 'landlord@example.com',
      vendorName: 'Acme Plumbing',
      phone: '123-456-7890',
      amount: '1250.00',
      address: '12 Main St',
    } as unknown as Parameters<typeof logEvent>[2]
    logEvent(logger, 'info', smuggled)
    const out = JSON.stringify(parsed())
    expect(out).not.toContain('landlord@example.com')
    expect(out).not.toContain('Acme Plumbing')
    expect(out).not.toContain('123-456-7890')
    expect(out).not.toContain('1250.00')
    expect(out).not.toContain('12 Main St')
    expect(parsed()[0].event).toBe('auth.login')
  })

  it('replaces a free-text reason with a marker so user input cannot ride along', () => {
    const { logger, parsed } = capture()
    logEvent(logger, 'warn', {
      event: 'auth.login',
      reason: 'no user for landlord@example.com',
    })
    const line = parsed()[0]
    expect(line.reason).toBe('unsafe_reason')
    expect(JSON.stringify(line)).not.toContain('landlord@example.com')
  })

  it('keeps a code-shaped reason verbatim', () => {
    const { logger, parsed } = capture()
    logEvent(logger, 'warn', { event: 'auth.login', reason: 'bad_password' })
    expect(parsed()[0].reason).toBe('bad_password')
  })

  it('drops allow-listed keys carrying a non-scalar value', () => {
    const { logger, parsed } = capture()
    logEvent(logger, 'info', {
      event: 'sheets.sync',
      // A Prisma error object assigned to `code` would serialize its whole graph.
      code: { nested: 'landlord@example.com' } as unknown as string,
    })
    expect(JSON.stringify(parsed())).not.toContain('landlord@example.com')
  })

  it('routes each level to the matching pino level', () => {
    const { logger, parsed } = capture()
    logEvent(logger, 'debug', { event: 'a' })
    logEvent(logger, 'info', { event: 'b' })
    logEvent(logger, 'warn', { event: 'c' })
    logEvent(logger, 'error', { event: 'd' })
    expect(parsed().map((l) => l.level)).toEqual([20, 30, 40, 50])
  })

  it('allow-lists only opaque identifiers and metrics — no human-readable fields', () => {
    // A guard on the allow-list itself: adding `email` or `name` to LOG_FIELD_KEYS
    // is exactly the mistake this system exists to prevent, so it fails here too.
    const banned = ['email', 'name', 'phone', 'address', 'amount', 'password', 'token', 'secret']
    // `tokenLookupId` is the ONE key allowed to name a credential, because it is
    // the non-secret half of the vendor link — the same half `redactUrlToken`
    // deliberately keeps in logged URLs for traceability.
    const exempt = new Set<string>(['tokenLookupId'])
    for (const key of LOG_FIELD_KEYS) {
      if (exempt.has(key)) continue
      for (const bad of banned) {
        expect(key.toLowerCase()).not.toContain(bad)
      }
    }
  })
})

describe('resolveLogLevel', () => {
  it('defaults to info', () => {
    expect(resolveLogLevel({})).toBe('info')
  })

  it('silences logs under test so suites stay readable', () => {
    expect(resolveLogLevel({ NODE_ENV: 'test' })).toBe('silent')
  })

  it('honours an explicit LOG_LEVEL, including over the test default', () => {
    expect(resolveLogLevel({ LOG_LEVEL: 'debug' })).toBe('debug')
    expect(resolveLogLevel({ NODE_ENV: 'test', LOG_LEVEL: 'warn' })).toBe('warn')
  })

  it('falls back to info on an unrecognised LOG_LEVEL rather than crashing boot', () => {
    expect(resolveLogLevel({ LOG_LEVEL: 'chatty' })).toBe('info')
  })
})
