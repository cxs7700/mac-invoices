import { hash, hashSync, verify } from '@node-rs/argon2'

/** Hash a plaintext password with argon2id (library defaults). */
export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

/**
 * Verify a password against a stored hash. Returns false (never throws) on a
 * malformed/placeholder hash, so a fail-closed comparison is safe.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

/**
 * A valid argon2id hash of a throwaway value, computed once at module load.
 * Used to run a real verify on the unknown-email login path so it takes the same
 * time as the wrong-password path (no user enumeration via response timing).
 */
export const DUMMY_HASH = hashSync('dummy-password-for-constant-time-login')
