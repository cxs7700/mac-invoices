import { describe, it, expect, afterEach } from 'vitest'
import { assertValidInviteCode } from '../src/auth/inviteCode'
import { AppError } from '../src/middleware/errorHandler'

const ORIGINAL = process.env.SIGNUP_INVITE_CODE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SIGNUP_INVITE_CODE
  else process.env.SIGNUP_INVITE_CODE = ORIGINAL
})

describe('assertValidInviteCode', () => {
  it('passes for the configured code', () => {
    process.env.SIGNUP_INVITE_CODE = 'the-real-code'
    expect(() => assertValidInviteCode('the-real-code')).not.toThrow()
  })

  it('throws SIGNUP_DISABLED (503) when the env var is unset', () => {
    delete process.env.SIGNUP_INVITE_CODE
    try {
      assertValidInviteCode('anything')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('SIGNUP_DISABLED')
      expect((err as AppError).statusCode).toBe(503)
    }
  })

  it('treats an empty env var as disabled, not as an empty valid code', () => {
    process.env.SIGNUP_INVITE_CODE = ''
    try {
      assertValidInviteCode('')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AppError).code).toBe('SIGNUP_DISABLED')
    }
  })

  it('throws INVALID_INVITE_CODE (403) for a wrong code', () => {
    process.env.SIGNUP_INVITE_CODE = 'the-real-code'
    try {
      assertValidInviteCode('not-the-code')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_INVITE_CODE')
      expect((err as AppError).statusCode).toBe(403)
    }
  })

  it('rejects a wrong code of a different length without throwing a length error', () => {
    // timingSafeEqual throws RangeError on unequal-length buffers; hashing both
    // sides first is what makes this safe. This test is the regression guard.
    process.env.SIGNUP_INVITE_CODE = 'short'
    try {
      assertValidInviteCode('a-very-much-longer-submission')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('INVALID_INVITE_CODE')
    }
  })

  it('never puts the configured code in the error message', () => {
    process.env.SIGNUP_INVITE_CODE = 'super-secret-code'
    try {
      assertValidInviteCode('wrong')
    } catch (err) {
      expect((err as AppError).message).not.toContain('super-secret-code')
    }
  })
})
