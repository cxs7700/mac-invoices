import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// U3 contractor CRUD (landlord, authed). Ownership-scoped with no existence
// leak: another landlord's contractor reads/patches as 404.
const app = buildApp()
let cookie: string
let other: Awaited<ReturnType<typeof createSecondUser>>

const create = (payload: object, c = cookie) =>
  app.inject({ method: 'POST', url: '/api/contractors', payload, headers: { cookie: c } })

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  other = await createSecondUser(app)
})
afterAll(async () => {
  // Cascades remove the landlord's contractors created here.
  await app.prisma.contractor.deleteMany({ where: { name: { startsWith: 'CRUD-' } } })
  await other.cleanup()
  await app.close()
})

describe('POST /api/contractors', () => {
  it('creates a contractor and returns a one-time link', async () => {
    const res = await create({ name: 'CRUD-Joe', contact: '555-1234' })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.name).toBe('CRUD-Joe')
    expect(body.linkActive).toBe(true)
    expect(body.link).toContain('/submit/inv_')
    // The token secret/hash are never returned.
    expect(JSON.stringify(body)).not.toMatch(/tokenHash|tokenLookupId/)
  })

  it('rejects empty name and an over-long name', async () => {
    expect((await create({ name: '  ', contact: 'x' })).statusCode).toBe(400)
    expect((await create({ name: 'a'.repeat(101), contact: 'x' })).statusCode).toBe(400)
  })
})

describe('GET /api/contractors', () => {
  it('lists only the landlord’s own contractors', async () => {
    await create({ name: 'CRUD-A', contact: 'a' })
    await create({ name: 'CRUD-Bystander', contact: 'b' }, other.cookie)
    const mine = await app.inject({ method: 'GET', url: '/api/contractors', headers: { cookie } })
    const names = mine.json().data.map((c: { name: string }) => c.name)
    expect(names).toContain('CRUD-A')
    expect(names).not.toContain('CRUD-Bystander')
  })
})

describe('GET/PATCH /api/contractors/:id', () => {
  it('gets and patches an own contractor', async () => {
    const id = (await create({ name: 'CRUD-Edit', contact: 'x' })).json().id
    expect((await app.inject({ method: 'GET', url: `/api/contractors/${id}`, headers: { cookie } })).statusCode).toBe(200)
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/contractors/${id}`,
      payload: { contact: '999-9999' },
      headers: { cookie },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().contact).toBe('999-9999')
  })

  it('404s a non-owned contractor for get and patch (no existence leak)', async () => {
    const id = (await create({ name: 'CRUD-Bystander2', contact: 'b' }, other.cookie)).json().id
    expect((await app.inject({ method: 'GET', url: `/api/contractors/${id}`, headers: { cookie } })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/contractors/${id}`, payload: { name: 'x' }, headers: { cookie } })).statusCode,
    ).toBe(404)
  })
})
