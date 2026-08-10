import { createHmac, timingSafeEqual } from 'node:crypto'
import { encodeBase64urlNoPadding } from '@oslojs/encoding'
import { AppError } from '../middleware/errorHandler'

// Operator-issued password-reset links. The token is DERIVED, never stored:
// `rst_<userId>.<expiresAtMs>.<mac>`, where the mac signs
// `userId:expiresAtMs:passwordHash:passwordResetVersion`.
//
// Including the CURRENT password hash is what makes a link single-use without a
// table: consuming it writes a new hash, so the old mac no longer verifies.
// Argon2id salts per call, so even re-using the same password produces a
// different hash and still kills the link.
//
// Including `passwordResetVersion` is what retires a link on RE-ISSUE, before
// it is ever consumed: issuing a link bumps the version and signs the new
// value in, so an older, unconsumed link — whose signature still names the
// old version — stops matching. This mirrors the vendor-link idiom (DEC-034),
// where `tokenVersion` plays exactly this role. The version is looked up
// server-side at verify time, never carried in the token itself.

const PREFIX = 'rst_'

/** One hour. Encoded in the token and signed, so it cannot be extended. */
export const RESET_TTL_MS = 1000 * 60 * 60

function resetKey(): Buffer {
  const raw = process.env.RESET_LINK_KEY
  if (!raw || raw.length < 32) {
    // Named and actionable rather than a generic INTERNAL_ERROR: this is a
    // deployment misconfiguration, and a 500 with no clue sends the operator
    // hunting through logs for what is a one-line env fix (the DEC-034 lesson).
    throw new AppError(
      'RESET_LINK_KEY_INVALID',
      'RESET_LINK_KEY is missing or shorter than 32 characters, so password-reset links cannot be derived. Set it in the environment and redeploy.',
      500,
    )
  }
  return Buffer.from(raw, 'utf8')
}

function mac(userId: string, expiresAtMs: number, passwordHash: string, version: number): string {
  const digest = createHmac('sha256', resetKey())
    .update(`${userId}:${expiresAtMs}:${passwordHash}:${version}`)
    .digest()
  return encodeBase64urlNoPadding(new Uint8Array(digest))
}

/**
 * The full link token for `userId`, valid until `expiresAtMs`, signed against
 * `version` (the account's current `passwordResetVersion`). `version` sits
 * before `expiresAtMs` in the parameter list deliberately — both are numbers,
 * and keeping them non-adjacent avoids a call site silently swapping them.
 * Recomputable at any time given the same inputs.
 */
export function buildResetToken(
  userId: string,
  passwordHash: string,
  version: number,
  expiresAtMs: number,
): string {
  return `${PREFIX}${userId}.${expiresAtMs}.${mac(userId, expiresAtMs, passwordHash, version)}`
}

export type ParsedResetToken = { userId: string; expiresAtMs: number; mac: string }

/**
 * Split the token, or null for ANY shape problem — so a malformed token is
 * rejected before it can cost a database read.
 */
export function parseResetToken(raw: unknown): ParsedResetToken | null {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null
  const parts = raw.slice(PREFIX.length).split('.')
  if (parts.length !== 3) return null
  const [userId, expiresRaw, macPart] = parts
  if (!userId || !macPart || !/^\d+$/.test(expiresRaw)) return null
  return { userId, expiresAtMs: Number(expiresRaw), mac: macPart }
}

/** Constant-time check that `parsed` signs exactly this password hash and version. */
export function resetTokenMatches(
  parsed: ParsedResetToken,
  passwordHash: string,
  version: number,
): boolean {
  const expected = Buffer.from(mac(parsed.userId, parsed.expiresAtMs, passwordHash, version), 'utf8')
  const actual = Buffer.from(parsed.mac, 'utf8')
  // Length-check first: timingSafeEqual THROWS on unequal lengths, and
  // branching on length leaks nothing here (the mac's length is fixed and
  // public) — same reasoning as the invite-code compare in DEC-029(a).
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
