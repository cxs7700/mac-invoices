import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// U1 — profile: edit display name (email read-only), session-scoped, no secret leak.
const app = buildApp()
let cookie: string
let other: Awaited<ReturnType<typeof createSecondUser>>

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  other = await createSecondUser(app)
})
afterAll(async () => {
  // Restore the landlord's name + locale so other suites aren't affected.
  await app.prisma.user.update({ where: { id: (await app.prisma.user.findFirstOrThrow({ where: { role: 'LANDLORD', email: process.env.LANDLORD_EMAIL ?? 'landlord@example.com' } })).id }, data: { name: 'Landlord', locale: 'en' } }).catch(() => {})
  await other.cleanup()
  await app.close()
})

const patch = (payload: object, c = cookie) =>
  app.inject({ method: 'PATCH', url: '/api/settings/profile', payload, headers: { cookie: c } })

describe('PATCH /api/settings/profile', () => {
  it('401s without auth', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/settings/profile', payload: { name: 'X' } })).statusCode).toBe(401)
  })

  it('edits the display name and never returns the password hash (AE2, AE5)', async () => {
    const res = await patch({ name: 'New Name' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.name).toBe('New Name')
    expect(body.email).toBeTruthy()
    expect(JSON.stringify(body)).not.toMatch(/passwordHash/)
    // /me reflects it on the next request.
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json()
    expect(me.name).toBe('New Name')
  })

  it('ignores an email field in the body (email is read-only)', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().email
    const res = await patch({ name: 'Keep', email: 'attacker@evil.com' })
    expect(res.statusCode).toBe(200)
    expect(res.json().email).toBe(before) // unchanged
  })

  it('rejects empty or over-long names', async () => {
    expect((await patch({ name: '   ' })).statusCode).toBe(400)
    expect((await patch({ name: 'a'.repeat(101) })).statusCode).toBe(400)
  })

  it('is scoped to the session user (a second user edits only themselves)', async () => {
    await patch({ name: 'Second Name' }, other.cookie)
    const theirs = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })).json()
    expect(theirs.name).toBe('Second Name')
    const mine = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json()
    expect(mine.name).toBe('Keep') // unaffected by the other user's edit
  })

  it('accepts a supported locale (and /me reflects it); locale-only update needs no name', async () => {
    const res = await patch({ locale: 'zh' }, other.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().locale).toBe('zh')
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })).json()
    expect(me.locale).toBe('zh')
    expect(me.name).toBe('Second Name') // locale-only update left the name intact
  })

  it('rejects an unsupported locale', async () => {
    expect((await patch({ locale: 'fr' }, other.cookie)).statusCode).toBe(400)
  })
})
