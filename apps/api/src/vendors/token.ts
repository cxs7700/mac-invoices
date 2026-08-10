import { createHmac, timingSafeEqual } from 'node:crypto'
import { encodeBase64urlNoPadding, encodeHexLowerCase } from '@oslojs/encoding'
import { AppError } from '../middleware/errorHandler'
import type { PrismaClient } from '../../prisma/generated/client.ts'

// Vendor link tokens are bearer credentials shaped `inv_<lookupId>_<secret>`
// (KTD-4). `lookupId` is a short, non-secret, indexed handle: validation parses
// it out and does a single point lookup rather than scanning every row.
//
// The secret is DERIVED, not stored: HMAC-SHA256(VENDOR_LINK_KEY, lookupId:version).
// That is what lets the landlord copy a vendor's link at any time instead of
// only in the seconds after minting it — the server can recompute the exact
// same string on demand. A database dump still yields no usable links, because
// the key lives only in the environment.
//
// Deriving from `lookupId` rather than the vendor's id is deliberate: the
// lookupId is generated before the row is inserted, so creation needs no
// second write to fill in a token that depends on the new row's own id.
//
// Rotation is `tokenVersion`: bumping it changes the derived secret, so every
// previously issued URL stops validating. Revocation stays a separate flag, so
// a link can be turned off without being replaced.

const PREFIX = 'inv_'

/**
 * The HMAC key. Required — there is no safe default, since a fallback would
 * make every deployment that forgot to set it share predictable link secrets.
 */
function linkKey(): Buffer {
  const raw = process.env.VENDOR_LINK_KEY
  if (!raw || raw.length < 32) {
    // A named AppError rather than a bare throw: this is a deployment
    // misconfiguration, and surfacing it as a generic INTERNAL_ERROR sends the
    // operator hunting through logs for what is a one-line env fix. It also
    // only fires on link-deriving paths — listing revoked vendors never derives
    // anything — so the symptom otherwise looks arbitrary.
    throw new AppError(
      'VENDOR_LINK_KEY_INVALID',
      'VENDOR_LINK_KEY is missing or shorter than 32 characters, so vendor submission links cannot be derived. Set it in the environment and redeploy.',
      500,
    )
  }
  return Buffer.from(raw, 'utf8')
}

/** A fresh, non-secret lookup handle (~72 bits). */
export function newLookupId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  // Hex so it never contains the `_` separator that splits the token.
  return encodeHexLowerCase(bytes)
}

/** The derived secret half of the token. */
function deriveSecret(lookupId: string, tokenVersion: number): string {
  const mac = createHmac('sha256', linkKey()).update(`${lookupId}:${tokenVersion}`).digest()
  return encodeBase64urlNoPadding(new Uint8Array(mac))
}

/** The full bearer token for a vendor's current link. Recomputable at any time. */
export function buildLinkToken(lookupId: string, tokenVersion: number): string {
  return `${PREFIX}${lookupId}_${deriveSecret(lookupId, tokenVersion)}`
}

export type ParsedToken = { lookupId: string; secret: string }

/** Split `inv_<lookupId>_<secret>`; null if the shape is wrong (rejected pre-DB). */
export function parseLinkToken(raw: unknown): ParsedToken | null {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null
  const rest = raw.slice(PREFIX.length)
  const idx = rest.indexOf('_')
  if (idx <= 0) return null
  const lookupId = rest.slice(0, idx)
  const secret = rest.slice(idx + 1)
  if (!lookupId || !secret) return null
  return { lookupId, secret }
}

export type ResolvedLink = { vendorId: string; landlordId: string }

/**
 * Resolve a bearer link to its vendor, or null for ANY failure — bad shape,
 * unknown lookupId, wrong secret, or revoked link — with no hint as to which.
 * The expected secret is derived and constant-time-compared even when the
 * lookupId misses (against a dummy), so a miss is not measurably faster than a
 * wrong secret.
 */
export async function validateLinkToken(
  prisma: PrismaClient,
  raw: unknown,
): Promise<ResolvedLink | null> {
  const parsed = parseLinkToken(raw)
  const vendor = parsed
    ? await prisma.vendor.findUnique({ where: { tokenLookupId: parsed.lookupId } })
    : null
  const expected = vendor
    ? deriveSecret(vendor.tokenLookupId, vendor.tokenVersion)
    : deriveSecret('dummy-lookup-never-matches', 0)
  const secretMatches = timingSafeEqualStr(parsed?.secret ?? '', expected)
  if (!parsed || !vendor || vendor.revokedAt !== null || !secretMatches) return null
  return { vendorId: vendor.id, landlordId: vendor.landlordId }
}

/** Constant-time compare of two strings, length-safe. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
