import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp, loggerOptions } from '../src/app'
import { prisma } from '../src/lib/prisma'

const INVITE = 'test-invite-code-abc123'
const createdUserIds: string[] = []
const openApps: Array<ReturnType<typeof buildApp>> = []

/**
 * Every test gets its OWN app instance. The signup limiter is 5/hour keyed on
 * IP, and `inject` always presents 127.0.0.1 — a shared instance would make
 * every test past the fifth 429 regardless of the code. The limiter's counter
 * is in-memory per instance, so a fresh app is a fresh bucket.
 */
async function freshApp() {
  const a = buildApp()
  await a.ready()
  openApps.push(a)
  return a
}

/** Unique per run so repeated local runs never collide on the email unique index. */
function uniqueEmail(prefix = 'signup') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

const validBody = (over: Record<string, unknown> = {}) => ({
  inviteCode: INVITE,
  email: uniqueEmail(),
  password: 'a-good-password',
  firstName: 'Ada',
  lastName: 'Lovelace',
  ...over,
})

async function signup(
  target: Awaited<ReturnType<typeof freshApp>>,
  payload: Record<string, unknown>,
) {
  const res = await target.inject({ method: 'POST', url: '/api/auth/signup', payload })
  if (res.statusCode === 201) createdUserIds.push(res.json().id)
  return res
}

beforeAll(() => {
  process.env.SIGNUP_INVITE_CODE = INVITE
})

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } })
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  }
  await Promise.all(openApps.map((a) => a.close()))
})

describe('POST /api/auth/signup', () => {
  it('creates a LANDLORD, sets a session cookie, and never returns the hash', async () => {
    const app = await freshApp()
    const body = validBody()
    const res = await signup(app, body)

    expect(res.statusCode).toBe(201)
    const user = res.json()
    expect(user.email).toBe(body.email)
    expect(user.role).toBe('LANDLORD')
    expect(user.firstName).toBe('Ada')
    expect(user.lastName).toBe('Lovelace')
    // name stays in sync with the split fields on every write (DEC-028).
    expect(user.name).toBe('Ada Lovelace')
    expect(user.passwordHash).toBeUndefined()

    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=strict')
  })

  it('lands the new user in an empty tenant', async () => {
    const app = await freshApp()
    const res = await signup(app, validBody())
    const cookie = String(res.headers['set-cookie']).split(';')[0]

    const invoices = await app.inject({ method: 'GET', url: '/api/invoices', headers: { cookie } })
    expect(invoices.statusCode).toBe(200)
    // The list endpoint's envelope is { data, pagination: { total, limit, offset } }.
    expect(invoices.json().data).toHaveLength(0)
    expect(invoices.json().pagination.total).toBe(0)
  })

  it('rejects a wrong invite code with 403 and creates nothing', async () => {
    const app = await freshApp()
    const email = uniqueEmail('wrongcode')
    const res = await signup(app, validBody({ inviteCode: 'not-the-code', email }))

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('INVALID_INVITE_CODE')
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
  })

  it('returns 503 and creates nothing when no invite code is configured', async () => {
    const app = await freshApp()
    const email = uniqueEmail('disabled')
    delete process.env.SIGNUP_INVITE_CODE
    try {
      const res = await signup(app, validBody({ email }))
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe('SIGNUP_DISABLED')
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    } finally {
      process.env.SIGNUP_INVITE_CODE = INVITE
    }
  })

  it('stores a mixed-case email lowercased, and that account can then log in', async () => {
    const app = await freshApp()
    const lower = uniqueEmail('mixedcase')
    const mixed = lower.toUpperCase()
    const password = 'a-good-password'

    const res = await signup(app, validBody({ email: mixed, password }))
    expect(res.statusCode).toBe(201)
    expect(res.json().email).toBe(lower)

    // The whole point of EmailSchema: log in with different casing than signup.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: mixed, password },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().email).toBe(lower)
  })

  it('rejects a duplicate email with 409 without disturbing the first account', async () => {
    const app = await freshApp()
    const email = uniqueEmail('dupe')
    const first = await signup(app, validBody({ email, password: 'first-password' }))
    expect(first.statusCode).toBe(201)

    const second = await signup(app, validBody({ email, password: 'second-password' }))
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('EMAIL_TAKEN')

    // The original password still works -- the failed signup changed nothing.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'first-password' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('rejects a 7-character password with 400', async () => {
    const app = await freshApp()
    const res = await signup(app, validBody({ password: '1234567' }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a blank first name with 400', async () => {
    const app = await freshApp()
    const res = await signup(app, validBody({ firstName: '  ' }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })
})

describe('signup rate limit', () => {
  it('returns 429 after exceeding 5 attempts in the window', async () => {
    const app = await freshApp()
    let last
    // The limiter is an onRequest hook, so it counts every attempt regardless
    // of whether the body or the invite code would have been rejected later.
    for (let i = 0; i < 7; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: {
          inviteCode: 'guess',
          email: uniqueEmail('rl'),
          password: 'a-good-password',
          firstName: 'A',
          lastName: 'B',
        },
      })
    }
    expect(last!.statusCode).toBe(429)
  })
})

describe('signup secrets stay out of logs', () => {
  it('the request serializer emits no request body', () => {
    const serialized = loggerOptions.serializers.req({
      method: 'POST',
      url: '/api/auth/signup',
      host: 'localhost',
      ip: '127.0.0.1',
      headers: {},
    })
    // Bodies are never logged, so the password and invite code cannot leak
    // through the request log line.
    expect(Object.keys(serialized).sort()).toEqual(['host', 'method', 'remoteAddress', 'url'])
  })
})
