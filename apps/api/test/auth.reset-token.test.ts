import { describe, it, expect } from 'vitest'

// Set before the helpers read it — `resetKey()` reads process.env lazily, at
// call time, so a plain top-level assignment is enough (no vi.hoisted needed).
process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'

import {
  buildResetToken,
  parseResetToken,
  resetTokenMatches,
  RESET_TTL_MS,
} from '../src/auth/resetToken'

const USER = 'clx0000000000000000000000'
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$0123456789abcdef'
const future = () => Date.now() + RESET_TTL_MS

describe('reset token', () => {
  it('round-trips: a freshly built token parses and matches its own hash and version', () => {
    const exp = future()
    const parsed = parseResetToken(buildResetToken(USER, HASH, 0, exp))!
    expect(parsed.userId).toBe(USER)
    expect(parsed.expiresAtMs).toBe(exp)
    expect(resetTokenMatches(parsed, HASH, 0)).toBe(true)
  })

  // This is what buys single-use with no table: consuming a link writes a new
  // hash, so the old mac stops verifying. If this test ever goes green-to-red,
  // reset links have silently become replayable.
  it('stops matching once the password hash changes', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, 0, future()))!
    expect(resetTokenMatches(parsed, `${HASH}-rotated`, 0)).toBe(false)
  })

  // This is what buys retire-on-reissue (R8): issuing a new link bumps the
  // version, so a token signed at the old version stops matching even though
  // it was never consumed.
  it('stops matching once the version advances', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, 0, future()))!
    expect(resetTokenMatches(parsed, HASH, 1)).toBe(false)
  })

  it('rejects a tampered mac', () => {
    const token = buildResetToken(USER, HASH, 0, future())
    const parsed = parseResetToken(token)!
    expect(resetTokenMatches({ ...parsed, mac: `${parsed.mac.slice(0, -1)}A` }, HASH, 0)).toBe(false)
  })

  it('rejects a tampered user id', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, 0, future()))!
    expect(resetTokenMatches({ ...parsed, userId: 'clx1111111111111111111111' }, HASH, 0)).toBe(
      false,
    )
  })

  it('rejects a tampered expiry (extending your own link must not work)', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, 0, future()))!
    expect(
      resetTokenMatches({ ...parsed, expiresAtMs: parsed.expiresAtMs + 86_400_000 }, HASH, 0),
    ).toBe(false)
  })

  it('parses nothing but the exact shape', () => {
    expect(parseResetToken(null)).toBeNull()
    expect(parseResetToken(42)).toBeNull()
    expect(parseResetToken('')).toBeNull()
    expect(parseResetToken('nope')).toBeNull()
    expect(parseResetToken(`rst_${USER}.notanumber.abc`)).toBeNull()
    expect(parseResetToken(`rst_${USER}.123`)).toBeNull() // too few parts
    expect(parseResetToken(`rst_.123.abc`)).toBeNull() // empty user id
  })

  it('refuses to derive anything when the key is missing or too short', () => {
    const saved = process.env.RESET_LINK_KEY
    try {
      delete process.env.RESET_LINK_KEY
      expect(() => buildResetToken(USER, HASH, 0, future())).toThrowError(/RESET_LINK_KEY/)
      process.env.RESET_LINK_KEY = 'too-short'
      expect(() => buildResetToken(USER, HASH, 0, future())).toThrowError(/RESET_LINK_KEY/)
    } finally {
      process.env.RESET_LINK_KEY = saved
    }
  })
})
