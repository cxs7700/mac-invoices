import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pino from 'pino'
import { buildApp, loggerOptions } from '../src/app'

// The guarantee this whole system exists for, tested end to end: drive real
// requests carrying real personal data through the real app, capture EVERY line
// the logger emits, and assert none of that data appears.
//
// A unit test on `logEvent` can only prove the helper is safe. This proves the
// app is — including Fastify's own automatic request/response lines, which no
// call site of ours controls.

const lines: string[] = []
const logger = pino(
  // 'trace' so nothing is filtered out by level: the test must see every line
  // the app is capable of emitting, not just the ones production would keep.
  { ...loggerOptions, level: 'trace' },
  { write: (s: string) => lines.push(s) },
)
const app = buildApp({ loggerInstance: logger })

const EMAIL = process.env.LANDLORD_EMAIL ?? 'landlord@example.com'
const PASSWORD = process.env.LANDLORD_PASSWORD ?? 'changeme-dev'

// Distinctive values: if any of these turn up in a log line, it came from the
// request we just made and nowhere else.
const VENDOR_NAME = 'Zzyzx Plumbing & Drains LLC'
const VENDOR_EMAIL = 'zzyzx-vendor@example.invalid'
const VENDOR_PHONE = '555-0142-9987'
const SECRET_PASSWORD = 'Tr0ub4dor-Zzyzx-horse-battery'

let cookie = ''
let vendorId = ''

beforeAll(async () => {
  await app.ready()
  expect(process.env.LANDLORD_PASSWORD, 'LANDLORD_PASSWORD must be set; reseed first').toBeTruthy()

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAIL, password: PASSWORD },
  })
  expect(login.statusCode).toBe(200)
  const raw = login.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw.join(';') : String(raw))
    .split(';')
    .find((p) => p.trim().startsWith('session='))!
    .trim()

  // A crashed earlier run leaves this row behind, and the UNIQUE index on
  // (landlordId, lower(name)) would 409 the create below — a confusing failure
  // that has nothing to do with logging. Clear it first so the suite is
  // re-runnable.
  const stale = await app.prisma.vendor.findMany({
    where: { name: VENDOR_NAME },
    select: { id: true },
  })
  if (stale.length > 0) {
    const ids = stale.map((v) => v.id)
    await app.prisma.invoice.deleteMany({ where: { vendorId: { in: ids } } })
    await app.prisma.vendor.deleteMany({ where: { id: { in: ids } } })
  }

  const created = await app.inject({
    method: 'POST',
    url: '/api/vendors',
    headers: { cookie },
    payload: { name: VENDOR_NAME, email: VENDOR_EMAIL, phone: VENDOR_PHONE },
  })
  expect(created.statusCode).toBe(201)
  vendorId = created.json().id
})

afterAll(async () => {
  if (vendorId) {
    await app.prisma.invoice.deleteMany({ where: { vendorId } })
    await app.prisma.vendor.deleteMany({ where: { id: vendorId } })
  }
  await app.close()
})

/** Everything logged so far, as one searchable blob. */
const logged = () => lines.join('\n')

describe('no personal data reaches the logs', () => {
  it('keeps vendor name, email and phone out of a create/read round trip', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/vendors', headers: { cookie } })
    expect(list.statusCode).toBe(200)
    // Sanity: the data really did flow through the app, so a pass means
    // "not logged", not "never happened".
    expect(list.payload).toContain(VENDOR_NAME)

    const out = logged()
    expect(out).not.toContain(VENDOR_NAME)
    expect(out).not.toContain(VENDOR_EMAIL)
    expect(out).not.toContain(VENDOR_PHONE)
  })

  it('keeps credentials out of a failed and a successful login', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: EMAIL, password: SECRET_PASSWORD },
    })
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody-zzyzx@example.invalid', password: SECRET_PASSWORD },
    })

    const out = logged()
    expect(out).not.toContain(SECRET_PASSWORD)
    expect(out).not.toContain(PASSWORD)
    expect(out).not.toContain(EMAIL)
    expect(out).not.toContain('nobody-zzyzx@example.invalid')
  })

  it('records the login failures it refuses to describe to the caller', async () => {
    // The response is identical for both failures (no enumeration oracle), but
    // the logs must still distinguish them or they are useless for triage.
    const events = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.event === 'auth.login' && l.outcome === 'denied')
    expect(events.map((e) => e.reason)).toContain('bad_password')
    expect(events.map((e) => e.reason)).toContain('no_account')
  })

  it('never logs a session cookie value', async () => {
    await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    const value = cookie.slice('session='.length)
    expect(value.length).toBeGreaterThan(10)
    expect(logged()).not.toContain(value)
  })

  it('logs a dead vendor link by its lookupId only, never its secret', async () => {
    // Every vendor read derives the link fresh, as a full SPA URL.
    const read = await app.inject({
      method: 'GET',
      url: `/api/vendors/${vendorId}`,
      headers: { cookie },
    })
    expect(read.statusCode).toBe(200)
    const token = /inv_[0-9a-f]+_[A-Za-z0-9_-]+/.exec(read.json().link ?? '')?.[0] ?? ''
    expect(token).toMatch(/^inv_[0-9a-f]+_/)
    const [, lookupId] = /^inv_([0-9a-f]+)_/.exec(token)!
    const secret = token.slice(`inv_${lookupId}_`.length)

    // Revoke, then use the now-dead link — the denial path we instrumented.
    await app.inject({
      method: 'POST',
      url: `/api/vendors/${vendorId}/revoke`,
      headers: { cookie },
    })
    const dead = await app.inject({ method: 'GET', url: `/api/submissions/${token}` })
    expect(dead.statusCode).toBe(404)

    const out = logged()
    expect(secret.length).toBeGreaterThan(10)
    expect(out).not.toContain(secret) // the credential never lands
    expect(out).toContain(lookupId) // the traceable half does

    const denial = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.event === 'submission.link.denied')
    expect(denial?.tokenLookupId).toBe(lookupId)
  })

  it('logs a validation failure without echoing the rejected input', async () => {
    // Zod's flattened error reaches the CALLER, which is fine — it is the
    // person who sent it. It must not reach the log drain.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/vendors',
      headers: { cookie },
      payload: { name: VENDOR_NAME, email: 'zzyzx-not-an-email-at-all' },
    })
    expect(bad.statusCode).toBe(400)
    expect(logged()).not.toContain('zzyzx-not-an-email-at-all')

    // findLast, not find: earlier tests in this file already logged 401s and
    // 404s through the same event, and the newest line is this request's.
    const err = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .findLast((l) => l.event === 'request.client_error')
    expect(err?.code).toBe('VALIDATION_ERROR')
    expect(err?.statusCode).toBe(400)
  })

  it('reuses an inbound request id so lines join with the platform trace', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/vendors',
      headers: { cookie, 'x-request-id': 'trace-abc-123' },
    })
    const tagged = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.reqId === 'trace-abc-123')
    expect(tagged.length).toBeGreaterThan(0)
  })
})
