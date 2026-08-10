import { describe, it, expect } from 'vitest'
import { describeTarget, keyFingerprint } from '../prisma/reset-link'

// Pure-function tests only — the script itself talks to Prisma and the
// filesystem-derived `invokedDirectly` guard, neither of which is safe or
// meaningful to exercise from a unit test. These cover the two pieces of
// logic that decide "is it safe to mint, and does the operator have enough
// to compare against the target environment" (fix 6).

describe('describeTarget', () => {
  it('reports host and pathname for a local database URL, and flags it local', () => {
    const target = describeTarget('postgresql://postgres:postgres@localhost:5433/invoices')
    expect(target).toEqual({ host: 'localhost', pathname: '/invoices', isLocal: true })
  })

  it('also treats 127.0.0.1 as local', () => {
    const target = describeTarget('postgresql://postgres:postgres@127.0.0.1:5432/invoices')
    expect(target?.isLocal).toBe(true)
  })

  it('flags a non-localhost host as not local', () => {
    const target = describeTarget('postgresql://user:pw@prod-db.example.com:5432/invoices')
    expect(target).toEqual({ host: 'prod-db.example.com', pathname: '/invoices', isLocal: false })
  })

  it('never returns the user, password, or query string', () => {
    const url =
      'postgresql://someuser:super-secret-password@prod-db.example.com:5432/invoices?api_key=topsecret&sslmode=require'
    const target = describeTarget(url)!
    const serialized = JSON.stringify(target)
    expect(serialized).not.toContain('someuser')
    expect(serialized).not.toContain('super-secret-password')
    expect(serialized).not.toContain('topsecret')
    expect(serialized).not.toContain('api_key')
    expect(target).toEqual({ host: 'prod-db.example.com', pathname: '/invoices', isLocal: false })
  })

  it('returns null for a value that is not a URL at all', () => {
    expect(describeTarget('')).toBeNull()
    expect(describeTarget('not-a-url')).toBeNull()
  })
})

describe('keyFingerprint', () => {
  it('is deterministic for the same key', () => {
    const key = 'test-reset-link-key-at-least-32-chars'
    expect(keyFingerprint(key)).toBe(keyFingerprint(key))
  })

  it('is 8 lowercase hex characters', () => {
    expect(keyFingerprint('some-key-value')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('differs for different keys', () => {
    expect(keyFingerprint('key-one-at-least-32-characters-long')).not.toBe(
      keyFingerprint('key-two-at-least-32-characters-long'),
    )
  })

  it('never contains the raw key', () => {
    const key = 'a-very-recognizable-secret-key-value'
    expect(keyFingerprint(key)).not.toContain(key)
  })
})
