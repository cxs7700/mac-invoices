import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'

// U1 — profile: edit first/last name and email (no verification flow), session-
// scoped, no secret leak. `name` (the generic display name) stays in sync.
const app = buildApp()
let cookie: string
let other: Awaited<ReturnType<typeof createSecondUser>>
let landlordId: string

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  other = await createSecondUser(app)
  // Held by id so the restore below cannot depend on the email still matching.
  // No test in this file changes the landlord's email any more — email is the
  // login identity and the other 13 files that log in as this landlord run in
  // parallel — but the name edit below is still a mutation of a shared row.
  const landlord = await app.prisma.user.findFirstOrThrow({
    where: { role: 'LANDLORD', email: process.env.LANDLORD_EMAIL ?? 'landlord@example.com' },
  })
  landlordId = landlord.id
})
afterAll(async () => {
  // Restore the landlord's display name + locale (by id) so other suites aren't
  // affected. The email is deliberately absent: nothing here changes it, and a
  // restore for a mutation that no longer happens would only suggest one does.
  await app.prisma.user
    .update({
      where: { id: landlordId },
      data: { name: 'Landlord', firstName: 'Landlord', lastName: null, locale: 'en' },
    })
    .catch(() => {})
  await other.cleanup()
  await app.close()
})

const patch = (payload: object, c = cookie) =>
  app.inject({ method: 'PATCH', url: '/api/settings/profile', payload, headers: { cookie: c } })

describe('PATCH /api/settings/profile', () => {
  it('401s without auth', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/settings/profile',
          payload: { firstName: 'X' },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('edits first/last name (syncing `name`) and never returns the password hash (AE2, AE5)', async () => {
    const res = await patch({ firstName: 'New', lastName: 'Name' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.firstName).toBe('New')
    expect(body.lastName).toBe('Name')
    expect(body.name).toBe('New Name')
    expect(body.email).toBeTruthy()
    expect(JSON.stringify(body)).not.toMatch(/passwordHash/)
    // /me reflects it on the next request.
    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    ).json()
    expect(me.firstName).toBe('New')
    expect(me.name).toBe('New Name')
  })

  // Runs against the throwaway user, NOT the shared seeded landlord. Email is
  // the login identity: while it was changed here, every other test file that
  // logs in as `landlord@example.com` got a 401 for the window until this
  // file's afterAll restored it. Test files run in parallel against one
  // database, so a different file failed on each run and every one of them
  // passed in isolation — which is what made it read as flakiness rather than
  // as this test. Nothing that shares a fixture may mutate its login identity.
  it('edits the email (no verification flow)', async () => {
    const email = `settings-test-${Date.now()}@example.com`
    const res = await patch({ email }, other.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().email).toBe(email)
    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })
    ).json()
    expect(me.email).toBe(email)
  })

  it('409s on a duplicate email', async () => {
    const theirEmail = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })
    ).json().email
    const res = await patch({ email: theirEmail })
    expect(res.statusCode).toBe(409)
  })

  it('rejects a malformed email', async () => {
    expect((await patch({ email: 'not-an-email' })).statusCode).toBe(400)
  })

  it('C1: lowercases a mixed-case email on save, and the account can still log in with it', async () => {
    const email = `Mixed-Case-${Date.now()}@Example.COM`
    const res = await patch({ email }, other.cookie)
    expect(res.statusCode).toBe(200)
    // Stored/returned email is lowercase, not the mixed case submitted.
    expect(res.json().email).toBe(email.toLowerCase())

    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })
    ).json()
    expect(me.email).toBe(email.toLowerCase())

    // The exact round trip C1 was about: login must still find the account,
    // whether the submitted email is lowercase or the original mixed case
    // (login itself lowercases before the exact-match lookup).
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'second-user-pass' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('rejects an empty or over-long firstName, and an over-long lastName', async () => {
    expect((await patch({ firstName: '   ' })).statusCode).toBe(400)
    expect((await patch({ firstName: 'a'.repeat(51) })).statusCode).toBe(400)
    expect((await patch({ lastName: 'a'.repeat(51) })).statusCode).toBe(400)
  })

  it('clears lastName to null when sent as an empty string', async () => {
    await patch({ firstName: 'Solo', lastName: 'Name' }, other.cookie)
    const res = await patch({ lastName: '   ' }, other.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().lastName).toBeNull()
    expect(res.json().name).toBe('Solo')
  })

  it('is scoped to the session user (a second user edits only themselves)', async () => {
    await patch({ firstName: 'Second', lastName: 'Name' }, other.cookie)
    const theirs = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })
    ).json()
    expect(theirs.name).toBe('Second Name')
    const mine = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    ).json()
    expect(mine.name).not.toBe('Second Name') // unaffected by the other user's edit
  })

  it('a partial update (lastName only) keeps the existing firstName and recomputes name', async () => {
    await patch({ firstName: 'Keep', lastName: 'Original' }, other.cookie)
    const res = await patch({ lastName: 'Changed' }, other.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().firstName).toBe('Keep')
    expect(res.json().lastName).toBe('Changed')
    expect(res.json().name).toBe('Keep Changed')
  })

  it('accepts a supported locale (and /me reflects it); locale-only update needs no name', async () => {
    const res = await patch({ locale: 'zh' }, other.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().locale).toBe('zh')
    const before = res.json().name
    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: other.cookie } })
    ).json()
    expect(me.locale).toBe('zh')
    expect(me.name).toBe(before) // locale-only update left the name intact
  })

  it('rejects an unsupported locale', async () => {
    expect((await patch({ locale: 'fr' }, other.cookie)).statusCode).toBe(400)
  })
})
