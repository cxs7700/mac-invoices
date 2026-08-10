import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import {
  buildLinkToken,
  newLookupId,
  parseLinkToken,
  validateLinkToken,
} from '../src/vendors/token'

// U4 link-token module: the bearer-credential primitive. Security-sensitive
// contract — uniform failure (revoked == never-existed), constant-time compare,
// and (since DEC-034) nothing secret at rest: the secret is derived from
// VENDOR_LINK_KEY rather than stored, which is what makes it re-displayable.
const app = buildApp()
let landlordId: string

// Name varies per call: vendor names are unique per landlord
// (case-insensitively — migration 20260807200000), and this file creates
// several vendors under the one shared `landlordId`.
async function makeVendor() {
  const lookupId = newLookupId()
  const v = await app.prisma.vendor.create({
    data: {
      landlordId,
      name: `Joe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phone: 'x',
      tokenLookupId: lookupId,
    },
  })
  return { vendor: v, plaintext: buildLinkToken(lookupId, v.tokenVersion) }
}

beforeAll(async () => {
  await app.ready()
  const l = await app.prisma.user.create({
    data: {
      email: `tok-${Date.now()}@example.com`,
      role: 'LANDLORD',
      passwordHash: await hashPassword('x'),
    },
  })
  landlordId = l.id
})
afterAll(async () => {
  await app.prisma.user.delete({ where: { id: landlordId } }).catch(() => {})
  await app.close()
})

describe('U4 link token', () => {
  it('a derived token validates to its vendor + landlord', async () => {
    const { vendor, plaintext } = await makeVendor()
    const resolved = await validateLinkToken(app.prisma, plaintext)
    expect(resolved).toEqual({ vendorId: vendor.id, landlordId })
  })

  it('stores no secret at all — only the non-secret lookup handle', async () => {
    const { vendor, plaintext } = await makeVendor()
    const row = await app.prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })
    expect(plaintext).toContain(row.tokenLookupId)
    // Every persisted column may leak into a dump; none of them may contain the
    // secret half of the token.
    const secret = parseLinkToken(plaintext)!.secret
    expect(JSON.stringify(row)).not.toContain(secret)
  })

  it('is stable across reads, so the same link can be copied again later', async () => {
    const { vendor } = await makeVendor()
    const row = await app.prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })
    const first = buildLinkToken(row.tokenLookupId, row.tokenVersion)
    const second = buildLinkToken(row.tokenLookupId, row.tokenVersion)
    expect(second).toBe(first)
    expect(await validateLinkToken(app.prisma, second)).not.toBeNull()
  })

  it('bumping tokenVersion retires the previous link', async () => {
    const { vendor, plaintext } = await makeVendor()
    const updated = await app.prisma.vendor.update({
      where: { id: vendor.id },
      data: { tokenVersion: { increment: 1 } },
    })
    expect(await validateLinkToken(app.prisma, plaintext)).toBeNull()
    const reissued = buildLinkToken(updated.tokenLookupId, updated.tokenVersion)
    expect(await validateLinkToken(app.prisma, reissued)).toEqual({
      vendorId: vendor.id,
      landlordId,
    })
  })

  it('a revoked token fails identically to a never-existing one (uniform null)', async () => {
    const { vendor, plaintext } = await makeVendor()
    await app.prisma.vendor.update({ where: { id: vendor.id }, data: { revokedAt: new Date() } })
    const revoked = await validateLinkToken(app.prisma, plaintext)
    const neverExisted = await validateLinkToken(app.prisma, 'inv_doesnotexist_deadbeefsecret')
    expect(revoked).toBeNull()
    expect(neverExisted).toBeNull()
  })

  it('rejects a malformed token pre-DB (parse returns null, no query)', () => {
    expect(parseLinkToken('nope')).toBeNull()
    expect(parseLinkToken('inv_onlyonepart')).toBeNull()
    expect(parseLinkToken('inv__emptylookup')).toBeNull()
    expect(parseLinkToken(undefined)).toBeNull()
    expect(parseLinkToken('bearer_abc_def')).toBeNull()
  })

  it('a right lookupId with the wrong secret fails the compare', async () => {
    const { plaintext } = await makeVendor()
    const parsed = parseLinkToken(plaintext)!
    const tampered = `inv_${parsed.lookupId}_${parsed.secret}TAMPERED`
    expect(await validateLinkToken(app.prisma, tampered)).toBeNull()
  })

  it("one vendor's token never validates as another's", async () => {
    const a = await makeVendor()
    const b = await makeVendor()
    const crossed = `inv_${parseLinkToken(a.plaintext)!.lookupId}_${parseLinkToken(b.plaintext)!.secret}`
    expect(await validateLinkToken(app.prisma, crossed)).toBeNull()
  })
})

describe('VENDOR_LINK_KEY misconfiguration', () => {
  // Regression: an unset or too-short key surfaced as a bare INTERNAL_ERROR,
  // and only on link-DERIVING paths — listing revoked vendors never derives, so
  // /vendors looked healthy while "Issue new link" 500'd. The named code is what
  // points the operator at the env var instead of at the logs.
  const withKey = (value: string | undefined, run: () => void) => {
    const previous = process.env.VENDOR_LINK_KEY
    if (value === undefined) delete process.env.VENDOR_LINK_KEY
    else process.env.VENDOR_LINK_KEY = value
    try {
      run()
    } finally {
      if (previous === undefined) delete process.env.VENDOR_LINK_KEY
      else process.env.VENDOR_LINK_KEY = previous
    }
  }

  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn()
    } catch (err) {
      return (err as { code?: string }).code
    }
    return undefined
  }

  it('names the failure when the key is unset', () => {
    withKey(undefined, () => {
      expect(codeOf(() => buildLinkToken('abc', 0))).toBe('VENDOR_LINK_KEY_INVALID')
    })
  })

  it('names the failure when the key is too short to be a real secret', () => {
    withKey('short', () => {
      expect(codeOf(() => buildLinkToken('abc', 0))).toBe('VENDOR_LINK_KEY_INVALID')
    })
  })

  it('accepts a key at the 32-character boundary', () => {
    withKey('x'.repeat(32), () => {
      expect(codeOf(() => buildLinkToken('abc', 0))).toBeUndefined()
    })
  })
})
