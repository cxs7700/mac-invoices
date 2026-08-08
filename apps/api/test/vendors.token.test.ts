import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { generateLinkToken, parseLinkToken, validateLinkToken } from '../src/vendors/token'

// U4 link-token module: the bearer-credential primitive. Security-sensitive
// contract — uniform failure (revoked == never-existed), constant-time compare,
// hashed-at-rest — is exactly what these tests pin.
const app = buildApp()
let landlordId: string

// Name varies per call: vendor names are now unique per landlord
// (case-insensitively — migration 20260807200000), and this file creates
// several vendors under the one shared `landlordId`.
async function makeVendor() {
  const link = generateLinkToken()
  const v = await app.prisma.vendor.create({
    data: {
      landlordId,
      name: `Joe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phone: 'x',
      tokenLookupId: link.lookupId,
      tokenHash: link.tokenHash,
    },
  })
  return { vendor: v, link }
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
  it('a freshly generated token validates to its vendor + landlord', async () => {
    const { vendor, link } = await makeVendor()
    const resolved = await validateLinkToken(app.prisma, link.plaintext)
    expect(resolved).toEqual({ vendorId: vendor.id, landlordId })
  })

  it('stores only the hash, never the plaintext secret (hashed at rest)', async () => {
    const { vendor, link } = await makeVendor()
    const row = await app.prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })
    expect(row.tokenHash).toBe(link.tokenHash)
    expect(link.plaintext).toContain(row.tokenLookupId)
    expect(link.plaintext).not.toContain(row.tokenHash) // the hash is not in the link
  })

  it('a revoked token fails identically to a never-existing one (uniform null)', async () => {
    const { vendor, link } = await makeVendor()
    await app.prisma.vendor.update({ where: { id: vendor.id }, data: { revokedAt: new Date() } })
    const revoked = await validateLinkToken(app.prisma, link.plaintext)
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

  it('a right lookupId with the wrong secret fails the hash compare', async () => {
    const { link } = await makeVendor()
    const parsed = parseLinkToken(link.plaintext)!
    const tampered = `inv_${parsed.lookupId}_${parsed.secret}TAMPERED`
    expect(await validateLinkToken(app.prisma, tampered)).toBeNull()
  })
})
