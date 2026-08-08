import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'
import { validateLinkToken } from '../src/vendors/token'

/** Pull the `inv_...` token out of a `.../submit/<token>` link URL. */
const tokenOf = (link: string) => link.split('/submit/')[1]

// U3 vendor CRUD (landlord, authed). Ownership-scoped with no existence
// leak: another landlord's vendor reads/patches as 404.
const app = buildApp()
let cookie: string
let other: Awaited<ReturnType<typeof createSecondUser>>

const create = (payload: object, c = cookie) =>
  app.inject({ method: 'POST', url: '/api/vendors', payload, headers: { cookie: c } })

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  other = await createSecondUser(app)
})
afterAll(async () => {
  // Cascades remove the landlord's vendors created here.
  await app.prisma.vendor.deleteMany({ where: { name: { startsWith: 'CRUD-' } } })
  await other.cleanup()
  await app.close()
})

describe('POST /api/vendors', () => {
  it('creates a vendor and returns a one-time link', async () => {
    const res = await create({ name: 'CRUD-Joe', phone: '555-1234' })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('CRUD-Joe')
    expect(body.linkActive).toBe(true)
    expect(body.link).toContain('/submit/inv_')
    // The token secret/hash are never returned.
    expect(JSON.stringify(body)).not.toMatch(/tokenHash|tokenLookupId/)
  })

  it('rejects empty name and an over-long name', async () => {
    expect((await create({ name: '  ', phone: 'x' })).statusCode).toBe(400)
    expect((await create({ name: 'a'.repeat(101), phone: 'x' })).statusCode).toBe(400)
  })

  it('creates a vendor with separate phone and email', async () => {
    const res = await create({ name: 'CRUD-Ace', phone: '555-0100', email: 'ace@example.com' })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('CRUD-Ace')
    expect(body.phone).toBe('555-0100')
    expect(body.email).toBe('ace@example.com')
    expect(body.link).toContain('/submit/')
    // The token secret and hash must never leave the server.
    expect(body.tokenHash).toBeUndefined()
    expect(body.tokenLookupId).toBeUndefined()
  })

  it('rejects a vendor with neither phone nor email', async () => {
    const res = await create({ name: 'CRUD-NoContact' })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/vendors', () => {
  it('lists only the landlord’s own vendors', async () => {
    await create({ name: 'CRUD-A', phone: 'a' })
    await create({ name: 'CRUD-Bystander', phone: 'b' }, other.cookie)
    const mine = await app.inject({ method: 'GET', url: '/api/vendors', headers: { cookie } })
    const names = mine.json().data.map((c: { name: string }) => c.name)
    expect(names).toContain('CRUD-A')
    expect(names).not.toContain('CRUD-Bystander')
  })
})

describe('GET/PATCH /api/vendors/:id', () => {
  it('gets and patches an own vendor', async () => {
    const id = (await create({ name: 'CRUD-Edit', phone: 'x' })).json().id
    expect(
      (await app.inject({ method: 'GET', url: `/api/vendors/${id}`, headers: { cookie } }))
        .statusCode,
    ).toBe(200)
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/vendors/${id}`,
      payload: { phone: '999-9999' },
      headers: { cookie },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().phone).toBe('999-9999')
  })

  it('updates only the supplied contact field', async () => {
    const created = (await create({ name: 'CRUD-Partial', phone: '555-0100' })).json()

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/vendors/${created.id}`,
      payload: { email: 'ace@example.com' },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().email).toBe('ace@example.com')
    expect(res.json().phone).toBe('555-0100')
  })

  it('404s a non-owned vendor for get and patch (no existence leak)', async () => {
    const id = (await create({ name: 'CRUD-Bystander2', phone: 'b' }, other.cookie)).json().id
    expect(
      (await app.inject({ method: 'GET', url: `/api/vendors/${id}`, headers: { cookie } }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/vendors/${id}`,
          payload: { name: 'x' },
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('revoke / regenerate (U5)', () => {
  const revoke = (id: string, c = cookie) =>
    app.inject({ method: 'POST', url: `/api/vendors/${id}/revoke`, headers: { cookie: c } })
  const regenerate = (id: string, c = cookie) =>
    app.inject({ method: 'POST', url: `/api/vendors/${id}/regenerate`, headers: { cookie: c } })

  it('revoke makes the link inert (validates to null, linkActive false)', async () => {
    const created = (await create({ name: 'CRUD-Revoke', phone: 'x' })).json()
    expect(await validateLinkToken(app.prisma, tokenOf(created.link))).not.toBeNull()
    const res = await revoke(created.id)
    expect(res.statusCode).toBe(200)
    expect(res.json().linkActive).toBe(false)
    expect(await validateLinkToken(app.prisma, tokenOf(created.link))).toBeNull()
  })

  it('regenerate kills the old link and the new one works', async () => {
    const created = (await create({ name: 'CRUD-Rotate', phone: 'x' })).json()
    const oldToken = tokenOf(created.link)
    const regenerated = (await regenerate(created.id)).json()
    const newToken = tokenOf(regenerated.link)
    expect(newToken).not.toBe(oldToken)
    expect(await validateLinkToken(app.prisma, oldToken)).toBeNull() // old is dead
    expect(await validateLinkToken(app.prisma, newToken)).not.toBeNull() // new works
    expect(regenerated.linkActive).toBe(true)
  })

  it('regenerate revives a previously revoked link', async () => {
    const created = (await create({ name: 'CRUD-Revive', phone: 'x' })).json()
    await revoke(created.id)
    const regenerated = (await regenerate(created.id)).json()
    expect(regenerated.linkActive).toBe(true)
    expect(await validateLinkToken(app.prisma, tokenOf(regenerated.link))).not.toBeNull()
  })

  it('revoke is idempotent and 404s a non-owned vendor', async () => {
    const id = (await create({ name: 'CRUD-Idem', phone: 'x' })).json().id
    expect((await revoke(id)).statusCode).toBe(200)
    expect((await revoke(id)).statusCode).toBe(200) // idempotent
    const otherId = (await create({ name: 'CRUD-Bystander3', phone: 'b' }, other.cookie)).json().id
    expect((await revoke(otherId)).statusCode).toBe(404)
    expect((await regenerate(otherId)).statusCode).toBe(404)
  })
})
