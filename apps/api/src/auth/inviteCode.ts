import { createHash, timingSafeEqual } from 'node:crypto'
import { AppError } from '../middleware/errorHandler'

/**
 * Signup is gated by one shared invite code held in SIGNUP_INVITE_CODE. The env
 * var doubles as the feature flag: unset (or empty) means signup is off
 * entirely, so preview and production stay closed until it is deliberately set.
 */
function configuredCode(): string {
  const code = process.env.SIGNUP_INVITE_CODE
  if (!code) {
    throw new AppError('SIGNUP_DISABLED', 'Signup is not enabled', 503)
  }
  return code
}

/**
 * SHA-256 both sides before comparing: `timingSafeEqual` throws RangeError on
 * unequal-length inputs, and branching on length would itself leak the code's
 * length. Digests are always 32 bytes.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Throws when signup is disabled (503) or the submitted code is wrong (403).
 * The message is identical for wrong and malformed codes so a caller learns
 * nothing about the real value.
 */
export function assertValidInviteCode(submitted: string): void {
  const expected = configuredCode()
  if (!timingSafeEqual(digest(submitted), digest(expected))) {
    throw new AppError('INVALID_INVITE_CODE', 'Invalid invite code', 403)
  }
}
