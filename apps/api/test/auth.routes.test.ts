import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'

const app = buildApp()
const EMAIL = process.env.LANDLORD_EMAIL ?? 'landlord@example.com'
const PASSWORD = process.env.LANDLORD_PASSWORD ?? 'changeme-dev'

beforeAll(async () => {
  await app.ready()
  expect(process.env.LANDLORD_PASSWORD, 'LANDLORD_PASSWORD must be set; reseed first').toBeTruthy()
})
afterAll(() => app.close())

/** Pull the session cookie value out of a login response's set-cookie header. */
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const header = Array.isArray(raw) ? raw.join(';') : String(raw)
  return header.split(';').find((p) => p.trim().startsWith('session='))!.trim()
}

describe('POST /api/auth/login', () => {
  it('returns 200 + an httpOnly session cookie for valid creds (no passwordHash)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.email).toBe(EMAIL)
    expect(body.passwordHash).toBeUndefined()
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')
  })

  it('returns 401 for a wrong password and for an unknown email (same shape)', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: EMAIL, password: 'definitely-wrong' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('UNAUTHORIZED')

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'x' },
    })
    expect(unknown.statusCode).toBe(401)
    expect(unknown.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns 400 for an invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/auth/me + logout', () => {
  it('401 without a cookie, the user with one, 401 again after logout', async () => {
    const noCookie = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(noCookie.statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    })
    const cookie = sessionCookie(login)

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().email).toBe(EMAIL)

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(logout.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('401 for a garbage cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'session=garbage-token' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('login rate limit', () => {
  it('returns 429 after exceeding the attempt limit', async () => {
    // Fresh app so the in-memory rate-limit counter starts at zero.
    const rl = buildApp()
    await rl.ready()
    let last
    for (let i = 0; i < 12; i++) {
      last = await rl.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'attacker@example.com', password: 'guess' },
      })
    }
    expect(last!.statusCode).toBe(429)
    await rl.close()
  })
})
