import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// U2 — change password: re-auth with the current password, then log out all
// OTHER sessions (keep the current one). Runs as a throwaway user so the
// landlord's seeded password is never mutated.
const app = buildApp()
let u: Awaited<ReturnType<typeof createSecondUser>>
const PASSWORD = 'second-user-pass' // the password createSecondUser sets

beforeAll(async () => {
  await app.ready()
  u = await createSecondUser(app)
})
afterAll(async () => {
  await u.cleanup()
  await app.close()
})

const change = (payload: object, c = u.cookie) =>
  app.inject({ method: 'POST', url: '/api/settings/password', payload, headers: { cookie: c } })
const meOk = async (c: string) =>
  (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c } })).statusCode === 200

describe('POST /api/settings/password', () => {
  it('401s without auth', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/settings/password', payload: {} })).statusCode).toBe(401)
  })

  it('rejects a wrong current password (401), password unchanged', async () => {
    const res = await change({ currentPassword: 'wrong', newPassword: 'brandnew123' })
    expect(res.statusCode).toBe(401)
    // The original password still authenticates (unchanged).
    expect(await meOk(await loginCookie(app, u.user.email, PASSWORD))).toBe(true)
  })

  it('rejects a too-short new password (400)', async () => {
    expect((await change({ currentPassword: PASSWORD, newPassword: 'short' })).statusCode).toBe(400)
  })

  it('changes the password and logs out other sessions, keeping the current one (AE1)', async () => {
    // Two live sessions for the same user.
    const sessionA = await loginCookie(app, u.user.email, PASSWORD)
    const sessionB = await loginCookie(app, u.user.email, PASSWORD)
    expect(await meOk(sessionA)).toBe(true)
    expect(await meOk(sessionB)).toBe(true)

    const res = await change({ currentPassword: PASSWORD, newPassword: 'a-brand-new-pw-123' }, sessionA)
    expect(res.statusCode).toBe(204)

    // Current session survives; the other is invalidated.
    expect(await meOk(sessionA)).toBe(true)
    expect(await meOk(sessionB)).toBe(false)
    // The new password authenticates; the old one no longer does.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.user.email, password: 'a-brand-new-pw-123' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.user.email, password: PASSWORD } })).statusCode).toBe(401)
  })

  it('rate-limits repeated attempts (429 within the window)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 15; i++) {
      codes.push((await change({ currentPassword: 'nope', newPassword: 'whatever123' })).statusCode)
    }
    expect(codes).toContain(429)
  })
})
