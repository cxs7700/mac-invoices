# Invite-Gated Landlord Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor holding a shared invite code create a landlord account from the auth card and land in the app already logged in.

**Architecture:** A new `POST /api/auth/signup` mirrors the existing login handler — same `hashPassword`/`createSession`/cookie path — gated by a constant-time comparison against a `SIGNUP_INVITE_CODE` env var that doubles as the feature flag (unset ⇒ 503). No schema change: `User.role` already defaults to `LANDLORD` and every tenant-scoped model keys off `userId`. On the web side, the existing disabled Sign up tab becomes a real toggle, and `Login.tsx` splits into a card shell plus two form components.

**Tech Stack:** Fastify 5, Prisma, Zod 4 (`@mac-invoices/shared`), `@node-rs/argon2` (via `hashPassword`), `@fastify/rate-limit`, React 19 + React Hook Form + TanStack Query, react-i18next, Vitest.

**Spec:** `docs/brainstorms/2026-08-07-invite-gated-signup-requirements.md`

## Global Constraints

- **Definition of Done for every task:** `npm run lint && npm run typecheck && npm run test` all green from the repo root.
- **Password floor is 8 characters, no composition rules** (spec R5). Do not add uppercase/digit/symbol requirements.
- **Signup rate limit is `max: 5, timeWindow: '1 hour'`** (spec R9). Login's existing `max: 10, timeWindow: '15 minutes'` is unchanged.
- **`SIGNUP_INVITE_CODE` unset ⇒ signup disabled**, returning `503 SIGNUP_DISABLED` (spec R3). Never default it to a literal.
- **The invite-code failure message must not distinguish wrong from malformed** (spec R2). One generic message.
- **`User.name` stays in sync with the split fields on every write** — `` `${firstName} ${lastName}` ``. This is an existing invariant documented on the model and relied on by DEC-028.
- **Both locale bundles must be updated** — `apps/web/src/locales/en/translation.json` and `apps/web/src/locales/zh/translation.json`. A key added to one and not the other is a bug.
- **Never log the password or invite code** (spec R10). The pino `req` serializer already omits bodies; do not add body logging.
- **⚠️ Always run the api suite against the LOCAL database.** The root `.env` `DATABASE_URL` points at the **hosted/production** database, and these tests create and delete `users` rows. Running the api suite bare would write to production. Use this exact invocation every time (verified working — 6/6 on `auth.routes`):

  ```bash
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" \
  LANDLORD_PASSWORD="changeme-dev" \
  npm test -w @mac-invoices/api
  ```

  Port **5433** because a native host Postgres shadows 5432. `dotenv` does not override variables already present in the environment, so the shell values win. The local DB has been reseeded so `landlord@example.com` / `changeme-dev` is a valid login. The shared and web suites need no override.

---

### Task 1: Shared `EmailSchema` + `SignupSchema`

Introduces case-insensitive email handling for **both** login and signup. This is the fix for the latent lockout described in the spec's problem frame: `POST /api/auth/login` looks up users with an exact-match `findUnique`, so without normalization an account created as `Foo@Bar.com` can never log in as `foo@bar.com`.

**Files:**
- Modify: `packages/shared/src/schemas/auth.ts`
- Test: `packages/shared/test/auth.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `EmailSchema: ZodType<string>` — trims and lowercases, then validates.
  - `SignupSchema` with fields `inviteCode: string`, `email: string`, `password: string`, `firstName: string`, `lastName: string`.
  - `type SignupInput = z.infer<typeof SignupSchema>`.
  - `LoginSchema` keeps its existing `{ email, password }` shape and `LoginInput` type; only its email normalization changes.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/test/auth.test.ts` (keep the existing `LoginSchema` describe block as-is):

```ts
import { describe, it, expect } from 'vitest'
import { LoginSchema, SignupSchema } from '../src/index'

describe('LoginSchema email normalization', () => {
  it('trims and lowercases the email so casing never blocks login', () => {
    const parsed = LoginSchema.parse({ email: '  Foo@Bar.COM ', password: 'secret' })
    expect(parsed.email).toBe('foo@bar.com')
  })
})

describe('SignupSchema', () => {
  const valid = {
    inviteCode: 'code',
    email: 'new@example.com',
    password: 'longenough',
    firstName: 'Ada',
    lastName: 'Lovelace',
  }

  it('accepts a complete valid payload', () => {
    expect(SignupSchema.safeParse(valid).success).toBe(true)
  })

  it('normalizes the email to trimmed lowercase', () => {
    expect(SignupSchema.parse({ ...valid, email: ' New@Example.COM ' }).email).toBe('new@example.com')
  })

  it('rejects a password shorter than 8 characters', () => {
    expect(SignupSchema.safeParse({ ...valid, password: '1234567' }).success).toBe(false)
  })

  it('accepts a password of exactly 8 characters', () => {
    expect(SignupSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true)
  })

  it('rejects a missing invite code', () => {
    expect(SignupSchema.safeParse({ ...valid, inviteCode: '' }).success).toBe(false)
  })

  it('rejects blank or whitespace-only names', () => {
    expect(SignupSchema.safeParse({ ...valid, firstName: '   ' }).success).toBe(false)
    expect(SignupSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false)
  })

  it('trims surrounding whitespace from names', () => {
    const parsed = SignupSchema.parse({ ...valid, firstName: '  Ada  ', lastName: ' Lovelace ' })
    expect(parsed.firstName).toBe('Ada')
    expect(parsed.lastName).toBe('Lovelace')
  })

  it('rejects a malformed email', () => {
    expect(SignupSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mac-invoices/shared`
Expected: FAIL — `SignupSchema` is not exported, and the `LoginSchema` normalization test fails because the current schema returns the email verbatim.

- [ ] **Step 3: Write the implementation**

Replace the whole of `packages/shared/src/schemas/auth.ts`:

```ts
import { z } from 'zod'

/**
 * Email as stored and compared everywhere: trimmed and lowercased BEFORE
 * validation, so `Foo@Bar.com` and `foo@bar.com` are the same account. Login
 * resolves users with an exact-match `findUnique`, so without this a
 * mixed-case signup could never log back in — and there is no password reset.
 */
export const EmailSchema = z.string().trim().toLowerCase().email()

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof LoginSchema>

/**
 * Invite-gated signup. `inviteCode` is checked server-side against the
 * SIGNUP_INVITE_CODE env var; it is present here only so the client can require
 * it before submitting. Names are required (not nullable like the DB columns)
 * so a new landlord's PDF Bill-To block renders without a Settings visit.
 */
export const SignupSchema = z.object({
  inviteCode: z.string().min(1),
  email: EmailSchema,
  password: z.string().min(8),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
})

export type SignupInput = z.infer<typeof SignupSchema>
```

Note on Zod 4: `z.string().trim().toLowerCase().email()` chains string transforms before the email check, so validation sees the normalized value. If `.email()` after the transforms trips a deprecation-related type error, reorder to `z.string().trim().email().toLowerCase()` — email validation is case-insensitive, so either order satisfies the tests. Do not switch to top-level `z.email()`; the rest of the repo uses the `z.string().email()` form.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mac-invoices/shared`
Expected: PASS, including the pre-existing `LoginSchema` tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `npm run lint && npm run typecheck`
Expected: clean. `SignupSchema` is re-exported automatically — `packages/shared/src/index.ts` already has `export * from './schemas/auth'`, so no index change is needed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/auth.ts packages/shared/test/auth.test.ts
git commit -m "feat(shared): case-insensitive EmailSchema + SignupSchema

Normalizes email at the schema boundary for login as well as signup.
Login resolves users with an exact-match findUnique, so a mixed-case
signup would otherwise create an account that could never log in --
and there is no password reset to recover it."
```

---

### Task 2: Invite-code gate

A focused module so the constant-time comparison and the disabled-when-unset behavior are testable without going through HTTP.

**Files:**
- Create: `apps/api/src/auth/inviteCode.ts`
- Test: `apps/api/test/auth.inviteCode.test.ts`

**Interfaces:**
- Consumes: `AppError` from `../middleware/errorHandler` (constructor: `new AppError(code, message, statusCode?, details?)`).
- Produces: `assertValidInviteCode(submitted: string): void` — returns nothing on success; throws `AppError` with code `SIGNUP_DISABLED` (503) when the env var is unset/empty, or `INVALID_INVITE_CODE` (403) on mismatch.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/auth.inviteCode.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { assertValidInviteCode } from '../src/auth/inviteCode'
import { AppError } from '../src/middleware/errorHandler'

const ORIGINAL = process.env.SIGNUP_INVITE_CODE

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SIGNUP_INVITE_CODE
  else process.env.SIGNUP_INVITE_CODE = ORIGINAL
})

describe('assertValidInviteCode', () => {
  it('passes for the configured code', () => {
    process.env.SIGNUP_INVITE_CODE = 'the-real-code'
    expect(() => assertValidInviteCode('the-real-code')).not.toThrow()
  })

  it('throws SIGNUP_DISABLED (503) when the env var is unset', () => {
    delete process.env.SIGNUP_INVITE_CODE
    try {
      assertValidInviteCode('anything')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('SIGNUP_DISABLED')
      expect((err as AppError).statusCode).toBe(503)
    }
  })

  it('treats an empty env var as disabled, not as an empty valid code', () => {
    process.env.SIGNUP_INVITE_CODE = ''
    try {
      assertValidInviteCode('')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AppError).code).toBe('SIGNUP_DISABLED')
    }
  })

  it('throws INVALID_INVITE_CODE (403) for a wrong code', () => {
    process.env.SIGNUP_INVITE_CODE = 'the-real-code'
    try {
      assertValidInviteCode('not-the-code')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_INVITE_CODE')
      expect((err as AppError).statusCode).toBe(403)
    }
  })

  it('rejects a wrong code of a different length without throwing a length error', () => {
    // timingSafeEqual throws RangeError on unequal-length buffers; hashing both
    // sides first is what makes this safe. This test is the regression guard.
    process.env.SIGNUP_INVITE_CODE = 'short'
    try {
      assertValidInviteCode('a-very-much-longer-submission')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      expect((err as AppError).code).toBe('INVALID_INVITE_CODE')
    }
  })

  it('never puts the configured code in the error message', () => {
    process.env.SIGNUP_INVITE_CODE = 'super-secret-code'
    try {
      assertValidInviteCode('wrong')
    } catch (err) {
      expect((err as AppError).message).not.toContain('super-secret-code')
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.inviteCode`
Expected: FAIL — cannot resolve `../src/auth/inviteCode`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/auth/inviteCode.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'
import { AppError } from '../middleware/errorHandler'

/**
 * Signup is gated by one shared invite code held in SIGNUP_INVITE_CODE. The env
 * var doubles as the feature flag: unset (or empty) means signup is off
 * entirely, so preview and production stay closed until it is deliberately set.
 */
function configuredCode(): string {
  const code = process.env.SIGNUP_INVITE_CODE
  if (!code) {
    throw new AppError('SIGNUP_DISABLED', 'Signup is not enabled', 503)
  }
  return code
}

/**
 * SHA-256 both sides before comparing: `timingSafeEqual` throws RangeError on
 * unequal-length inputs, and branching on length would itself leak the code's
 * length. Digests are always 32 bytes.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Throws when signup is disabled (503) or the submitted code is wrong (403).
 * The message is identical for wrong and malformed codes so a caller learns
 * nothing about the real value.
 */
export function assertValidInviteCode(submitted: string): void {
  const expected = configuredCode()
  if (!timingSafeEqual(digest(submitted), digest(expected))) {
    throw new AppError('INVALID_INVITE_CODE', 'Invalid invite code', 403)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.inviteCode`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/inviteCode.ts apps/api/test/auth.inviteCode.test.ts
git commit -m "feat(api): constant-time invite-code gate for signup

SIGNUP_INVITE_CODE doubles as the feature flag -- unset means signup is
off (503). Both sides are SHA-256'd before timingSafeEqual so unequal
lengths neither throw nor leak the configured code's length."
```

---

### Task 3: `POST /api/auth/signup`

**Files:**
- Modify: `apps/api/src/auth/routes.ts` (add a route to the existing plugin; leave login/logout/me untouched)
- Modify: `.env.example` (document `SIGNUP_INVITE_CODE`)
- Test: `apps/api/test/auth.signup.test.ts`

**Interfaces:**
- Consumes: `SignupSchema` (Task 1); `assertValidInviteCode` (Task 2); existing `parseBody`, `hashPassword`, `createSession`, `sessionCookieOptions`, `SESSION_COOKIE`, `AppError`.
- Produces: `POST /api/auth/signup` returning **201** with the same body shape login returns — `{ id, email, name, firstName, lastName, role, locale }` — and a `Set-Cookie: session=…` header. Task 5's `useSignup` depends on this shape.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/auth.signup.test.ts`:

```ts
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

async function signup(target: Awaited<ReturnType<typeof freshApp>>, payload: Record<string, unknown>) {
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
        payload: { inviteCode: 'guess', email: uniqueEmail('rl'), password: 'a-good-password', firstName: 'A', lastName: 'B' },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.signup`
Expected: FAIL — the route does not exist, so requests return 404.

If the run instead errors on connecting to Postgres, start the local DB first (`docker compose up -d`) and make sure `LANDLORD_PASSWORD` is set; the api suite needs a live DB.

- [ ] **Step 3: Add the route**

In `apps/api/src/auth/routes.ts`, extend the imports:

```ts
import { LoginSchema, SignupSchema } from '@mac-invoices/shared'
import { verifyPassword, hashPassword, DUMMY_HASH } from './password'
import { assertValidInviteCode } from './inviteCode'
```

Then add this route **after** the login route and before `POST /api/auth/logout`:

```ts
  app.post(
    '/api/auth/signup',
    // Far tighter than login (10/15min): this is an unauthenticated endpoint
    // that creates tenant rows, not just a credential check.
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { inviteCode, email, password, firstName, lastName } = parseBody(
        SignupSchema,
        request.body,
      )

      // Gate first: an unconfigured or wrong code must never touch the DB.
      assertValidInviteCode(inviteCode)

      const existing = await request.server.prisma.user.findUnique({ where: { email } })
      if (existing) {
        // Deliberately specific (not folded into a generic failure) so the
        // visitor knows to log in instead of retrying. This is user
        // enumeration, but only for a caller who already holds a valid invite
        // code and has cleared the hourly limit. Login itself stays
        // non-enumerating (DEC-018's constant-time dummy verify).
        throw new AppError('EMAIL_TAKEN', 'An account with this email already exists', 409)
      }

      const passwordHash = await hashPassword(password)

      // `name` is kept in sync with the split fields on every write (DEC-028) —
      // the PDF Bill-To block and the ledger actor names read it.
      // A concurrent signup racing the check above surfaces as P2002, which the
      // central error handler already renders as 409 CONFLICT.
      const user = await request.server.prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`,
          role: 'LANDLORD',
        },
      })

      const { token, expiresAt } = await createSession(user.id, request.cookies?.[SESSION_COOKIE])
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt))

      return reply.code(201).send({
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        locale: user.locale,
      })
    },
  )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.signup`
Expected: PASS (10 tests).

- [ ] **Step 5: Verify the existing auth suite still passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth`
Expected: PASS — `auth.routes.test.ts`, `auth.session.test.ts`, and both new files. This is the regression gate for the `EmailSchema` change against the seeded landlord (spec AE5).

If the seeded landlord's login now fails, their `LANDLORD_EMAIL` contains uppercase. Lowercase it in `.env` and re-run the seed. **This is exactly the deploy-time hazard the spec calls out — note it and carry it into Task 6's docs.**

- [ ] **Step 6: Document the env var**

In `.env.example`, add after the `COOKIE_SECURE=false` line:

```bash
# Shared invite code required to create an account at /login → Sign up. UNSET =
# signup is disabled entirely (the endpoint 503s), which is the default posture.
# Rotating it invalidates it for everyone — there are no per-invite codes.
SIGNUP_INVITE_CODE=
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/routes.ts apps/api/test/auth.signup.test.ts .env.example
git commit -m "feat(api): POST /api/auth/signup, invite-gated

Creates a LANDLORD and opens a session in one step, returning login's
response shape so the web client reuses the existing auth-cache path.
Rate limited 5/hour. Duplicate email 409s specifically (EMAIL_TAKEN) so
the visitor knows to log in; login itself stays non-enumerating."
```

---

### Task 4: Extract `LoginForm` from `Login.tsx`

Pure refactor, no behavior change — kept separate so a reviewer can confirm the move is faithful before a second form lands beside it.

**Files:**
- Create: `apps/web/src/components/auth/authField.ts`
- Create: `apps/web/src/components/auth/LoginForm.tsx`
- Modify: `apps/web/src/pages/Login.tsx`

**Interfaces:**
- Consumes: existing `useLogin`, `LoginSchema`, `LoginInput`, `ApiError`, `Button`.
- Produces:
  - `fieldClass: string` exported from `@/components/auth/authField`.
  - `LoginForm` — a default-export-free named component taking **no props**; owns its own form state, server-error rendering, and post-success navigation to `/`.

- [ ] **Step 1: Create the shared field class**

Create `apps/web/src/components/auth/authField.ts`:

```ts
/** Shared input styling for the auth card's forms. */
export const fieldClass =
  'w-full px-3 py-2 rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
```

- [ ] **Step 2: Move the form into `LoginForm.tsx`**

Create `apps/web/src/components/auth/LoginForm.tsx` — this is the existing form lifted verbatim, with `fieldClass` now imported:

```tsx
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LoginSchema, type LoginInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useLogin } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from './authField'

export function LoginForm() {
  const navigate = useNavigate()
  const login = useLogin()
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) as Resolver<LoginInput> })

  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? t('login.serverError')
        : null

  const onSubmit = handleSubmit(
    (creds) => login.mutate(creds, { onSuccess: () => navigate('/', { replace: true }) }),
    (errs) => setFocus(errs.email ? 'email' : 'password'),
  )

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">
          {t('login.email')}
        </label>
        <input id="email" type="email" className={fieldClass} {...register('email')} />
        {errors.email && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium mb-1">
          {t('login.password')}
        </label>
        <input id="password" type="password" className={fieldClass} {...register('password')} />
        {errors.password && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {serverError && (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {serverError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={login.isPending}>
        {login.isPending ? t('login.signingIn') : t('login.logIn')}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Reduce `Login.tsx` to the card shell**

Replace the whole of `apps/web/src/pages/Login.tsx`. The Sign up tab stays disabled in this task — it is activated in Task 5:

```tsx
import { useTranslation } from 'react-i18next'
import { LoginForm } from '@/components/auth/LoginForm'
import { Button } from '@/components/ui/button'

export default function Login() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-7">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold text-foreground">{t('app.name')}</div>
          <p className="text-sm text-muted-foreground mt-1">{t('login.welcome')}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
          <span className="rounded bg-card py-1.5 text-center font-medium text-foreground">
            {t('login.logIn')}
          </span>
          <span
            className="py-1.5 text-center text-muted-foreground"
            aria-disabled="true"
            title={t('login.signUpSoon')}
          >
            {t('login.signUp')}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full mb-3"
          aria-disabled="true"
          aria-label={t('login.googleAria')}
          tabIndex={-1}
          disabled
        >
          {t('login.google')}
          <span className="ml-2 text-xs text-muted-foreground">{t('nav.soon')}</span>
        </Button>

        <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> {t('login.or')} <span className="h-px flex-1 bg-border" />
        </div>

        <LoginForm />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify nothing changed behaviorally**

Run: `npm run lint && npm run typecheck && npm test -w @mac-invoices/web`
Expected: PASS. No test should need editing — if one does, the refactor was not faithful.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/auth/ apps/web/src/pages/Login.tsx
git commit -m "refactor(web): extract LoginForm from the auth card

No behavior change. Makes room for a second form beside it without
Login.tsx carrying two full forms."
```

---

### Task 5: `SignupForm` + working toggle

**Files:**
- Create: `apps/web/src/components/auth/SignupForm.tsx`
- Modify: `apps/web/src/hooks/useAuth.ts` (add `useSignup`)
- Modify: `apps/web/src/pages/Login.tsx` (real toggle)
- Modify: `apps/web/src/locales/en/translation.json`, `apps/web/src/locales/zh/translation.json`
- Test: `apps/web/test/Signup.test.tsx`

**Interfaces:**
- Consumes: `SignupSchema`/`SignupInput` (Task 1); `POST /api/auth/signup` returning `{ id, email, name, firstName, lastName, role, locale }` (Task 3); `fieldClass`, `LoginForm` (Task 4).
- Produces: `useSignup()` — a TanStack mutation taking `SignupInput` and seeding the `['me']` cache exactly as `useLogin` does; `SignupForm` — no props.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/Signup.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Login from '@/pages/Login'
import i18n from '@/lib/i18n'

const signupMutate = vi.fn()
const loginMutate = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useLogin: () => ({ mutate: loginMutate, isPending: false, error: null }),
  useSignup: () => ({ mutate: signupMutate, isPending: false, error: null }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  i18n.changeLanguage('en')
})

const renderLogin = () =>
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )

describe('auth card toggle', () => {
  it('shows the login form first, with no signup-only fields', () => {
    renderLogin()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.queryByLabelText('Invite code')).toBeNull()
  })

  it('swaps to the signup form when the Sign up tab is clicked', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(screen.getByLabelText('Invite code')).toBeTruthy()
    expect(screen.getByLabelText('First name')).toBeTruthy()
    expect(screen.getByLabelText('Last name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
  })

  it('swaps back to login', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.queryByLabelText('Invite code')).toBeNull()
  })

  it('submits the full signup payload', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(signupMutate).toHaveBeenCalled())
    expect(signupMutate.mock.calls[0][0]).toEqual({
      inviteCode: 'the-code',
      email: 'ada@example.com',
      password: 'a-good-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('blocks submission and reports a too-short password', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(signupMutate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @mac-invoices/web -- Signup`
Expected: FAIL — no button named "Sign up" exists yet (it is a disabled `<span>`), and `useSignup` is not exported.

- [ ] **Step 3: Add the `useSignup` hook**

In `apps/web/src/hooks/useAuth.ts`, extend the type import and append the hook after `useLogin`:

```ts
import type { LoginInput, SignupInput } from '@mac-invoices/shared'
```

```ts
/**
 * Signup logs the new user straight in — the endpoint issues a session and
 * returns login's response shape, so the cache seeding is identical.
 */
export function useSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SignupInput) =>
      apiClient<AuthUser>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
  })
}
```

- [ ] **Step 4: Add the translation keys**

In `apps/web/src/locales/en/translation.json`, replace the `"signUpSoon"` line inside `"login"` and add the new keys:

```json
  "login": {
    "welcome": "Welcome back — sign in to continue.",
    "signUpWelcome": "Create your account to get started.",
    "logIn": "Log in",
    "signUp": "Sign up",
    "google": "Continue with Google",
    "googleAria": "Continue with Google (coming soon)",
    "or": "or",
    "email": "Email",
    "password": "Password",
    "inviteCode": "Invite code",
    "firstName": "First name",
    "lastName": "Last name",
    "createAccount": "Create account",
    "creatingAccount": "Creating account…",
    "serverError": "Could not reach the server",
    "signingIn": "Signing in…"
  },
```

And the matching block in `apps/web/src/locales/zh/translation.json`:

```json
  "login": {
    "welcome": "欢迎回来，请登录以继续。",
    "signUpWelcome": "创建账户以开始使用。",
    "logIn": "登录",
    "signUp": "注册",
    "google": "使用 Google 继续",
    "googleAria": "使用 Google 继续（即将推出）",
    "or": "或",
    "email": "邮箱",
    "password": "密码",
    "inviteCode": "邀请码",
    "firstName": "名",
    "lastName": "姓",
    "createAccount": "创建账户",
    "creatingAccount": "创建中…",
    "serverError": "无法连接服务器",
    "signingIn": "登录中…"
  },
```

`login.signUpSoon` is removed from both files — it described an affordance that no longer exists. Grep to confirm nothing still references it: `grep -rn "signUpSoon" apps/web/src` must return nothing after Step 5.

- [ ] **Step 5: Write `SignupForm`**

Create `apps/web/src/components/auth/SignupForm.tsx`:

```tsx
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SignupSchema, type SignupInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useSignup } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from './authField'

export function SignupForm() {
  const navigate = useNavigate()
  const signup = useSignup()
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<SignupInput>({ resolver: zodResolver(SignupSchema) as Resolver<SignupInput> })

  // ApiError carries the server's message, so EMAIL_TAKEN ("An account with
  // this email already exists") and INVALID_INVITE_CODE surface as-is.
  const serverError =
    signup.error instanceof ApiError
      ? signup.error.message
      : signup.error
        ? t('login.serverError')
        : null

  const onSubmit = handleSubmit(
    (input) => signup.mutate(input, { onSuccess: () => navigate('/', { replace: true }) }),
    (errs) => {
      const first = (['inviteCode', 'email', 'password', 'firstName', 'lastName'] as const).find(
        (f) => errs[f],
      )
      if (first) setFocus(first)
    },
  )

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="inviteCode" className="block text-sm font-medium mb-1">
          {t('login.inviteCode')}
        </label>
        <input id="inviteCode" type="text" className={fieldClass} {...register('inviteCode')} />
        {errors.inviteCode && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.inviteCode.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium mb-1">
            {t('login.firstName')}
          </label>
          <input id="firstName" type="text" className={fieldClass} {...register('firstName')} />
          {errors.firstName && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.firstName.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium mb-1">
            {t('login.lastName')}
          </label>
          <input id="lastName" type="text" className={fieldClass} {...register('lastName')} />
          {errors.lastName && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="signup-email" className="block text-sm font-medium mb-1">
          {t('login.email')}
        </label>
        <input id="signup-email" type="email" className={fieldClass} {...register('email')} />
        {errors.email && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="signup-password" className="block text-sm font-medium mb-1">
          {t('login.password')}
        </label>
        <input
          id="signup-password"
          type="password"
          className={fieldClass}
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {serverError && (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {serverError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={signup.isPending}>
        {signup.isPending ? t('login.creatingAccount') : t('login.createAccount')}
      </Button>
    </form>
  )
}
```

The email and password inputs use `signup-` prefixed ids so they never collide with `LoginForm`'s `email`/`password` ids if both ever render.

- [ ] **Step 6: Activate the toggle in `Login.tsx`**

Replace the whole of `apps/web/src/pages/Login.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoginForm } from '@/components/auth/LoginForm'
import { SignupForm } from '@/components/auth/SignupForm'
import { Button } from '@/components/ui/button'

type Mode = 'login' | 'signup'

export default function Login() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('login')

  const tabClass = (active: boolean) =>
    active
      ? 'rounded bg-card py-1.5 text-center font-medium text-foreground'
      : 'rounded py-1.5 text-center text-muted-foreground hover:text-foreground'

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-sm p-7">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold text-foreground">{t('app.name')}</div>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'login' ? t('login.welcome') : t('login.signUpWelcome')}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1 text-sm">
          <button
            type="button"
            className={tabClass(mode === 'login')}
            aria-pressed={mode === 'login'}
            onClick={() => setMode('login')}
          >
            {t('login.logIn')}
          </button>
          <button
            type="button"
            className={tabClass(mode === 'signup')}
            aria-pressed={mode === 'signup'}
            onClick={() => setMode('signup')}
          >
            {t('login.signUp')}
          </button>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full mb-3"
          aria-disabled="true"
          aria-label={t('login.googleAria')}
          tabIndex={-1}
          disabled
        >
          {t('login.google')}
          <span className="ml-2 text-xs text-muted-foreground">{t('nav.soon')}</span>
        </Button>

        <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> {t('login.or')} <span className="h-px flex-1 bg-border" />
        </div>

        {mode === 'login' ? <LoginForm /> : <SignupForm />}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @mac-invoices/web -- Signup`
Expected: PASS (5 tests).

- [ ] **Step 8: Confirm the retired key is fully gone and the whole suite is green**

Run: `grep -rn "signUpSoon" apps/web/src apps/web/test`
Expected: no output.

Run: `npm run lint && npm run typecheck && npm run test`
Expected: all green across workspaces.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/test/Signup.test.tsx
git commit -m "feat(web): working signup form behind the auth card toggle

Activates the previously disabled Sign up tab; retires login.signUpSoon.
Signup seeds the ['me'] cache like login does, so a new landlord lands
in the app already authenticated."
```

---

### Task 6: Deployment docs + decision record

**Files:**
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Document the env var in `DEPLOYMENT.md`**

In the **"Optional — set only to enable a feature"** table (around line 116), add a row:

```markdown
| `SIGNUP_INVITE_CODE` | invite-gated signup at `/login` → Sign up | **unset = signup is disabled** (`503 SIGNUP_DISABLED`), which is the default. One shared code for everyone; rotating it invalidates it for all invitees. Treat as sensitive. |
```

- [ ] **Step 2: Add the lowercase-email warning to the seed section**

In `docs/DEPLOYMENT.md` §4 ("Seed the landlord"), add after the existing paragraph:

```markdown
> **`LANDLORD_EMAIL` must be lowercase.** Email is normalized to trimmed lowercase at the
> schema boundary for both login and signup, so an address seeded with uppercase cannot be
> logged into. If an existing deploy has uppercase in `LANDLORD_EMAIL`, lowercase it and
> re-run the seed when shipping this change.
```

- [ ] **Step 3: Record DEC-029**

Append to `docs/DECISIONS.md`:

```markdown
## Invite-gated signup (2026-08-07)

- **DEC-029 — Public signup behind a shared invite-code env var; email normalized to lowercase app-wide** (plan: `docs/plans/2026-08-07-001-feat-invite-gated-signup-plan.md`, spec: `docs/brainstorms/2026-08-07-invite-gated-signup-requirements.md`). **Supersedes DEC-018's "no signup"** on that point only; its session, argon2id, cookie, and constant-time-login decisions carry forward unchanged. (a) **Gating is one shared `SIGNUP_INVITE_CODE` env var**, SHA-256'd on both sides before `timingSafeEqual` (unequal lengths would otherwise throw `RangeError`, and branching on length leaks the code's length). The var doubles as the feature flag — unset ⇒ `503 SIGNUP_DISABLED` — so preview and production stay closed by default. Rejected for now: an `InviteCode` table with per-invite revocation/audit (a migration plus a management surface, for a handful of personally-known invitees), and an email allowlist (requires a redeploy per invitee). (b) **No schema change**: `User.role` already defaults to `LANDLORD` and `Contractor`/`Property`/`Invoice` already scope by `userId`, so a signup is already a fully isolated tenant. (c) **No email verification and no password reset**, consistent with DEC-028(b)'s accepted posture on editable email — the invite code establishes who may create an account, so verification adds little here. Accepted risk: a mistyped email is an unrecoverable account requiring a direct DB fix. Password reset is the designated follow-up and is cheap, because `sendEmail()` (Resend) already exists. (d) **Email is normalized to trimmed lowercase in a shared `EmailSchema` used by `LoginSchema` too** — deliberately changing existing login behavior. Login resolves users via an exact-match `findUnique`, so without this a mixed-case signup produced an account that could never log in. The deploy hazard is that a `LANDLORD_EMAIL` containing uppercase stops working; `docs/DEPLOYMENT.md` §4 carries the warning and the auth suite is the gate. (e) **A duplicate email 409s specifically (`EMAIL_TAKEN`)** rather than hiding behind a generic failure, so the visitor knows to log in instead of retrying. This is user enumeration, but only for a caller who already holds a valid invite code and has cleared the 5/hour limit; login itself remains non-enumerating. (f) **Signup is rate-limited 5/hour** against login's 10/15min — it is an unauthenticated endpoint that creates tenant rows. (g) **Google OAuth stays disabled**, as designed.
```

- [ ] **Step 4: Final full verification**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: all green.

- [ ] **Step 5: Manual smoke test**

```bash
# Terminal 1
docker compose up -d
SIGNUP_INVITE_CODE=local-test-code npm run dev:api

# Terminal 2
npm run dev
```

Then in the browser: open the app, click **Sign up**, submit with `local-test-code` and a fresh email → you should land on the dashboard already logged in, with empty invoice/property/contractor lists. Log out, then log back in **using different email casing** than you signed up with → it should succeed. Finally, restart the api without `SIGNUP_INVITE_CODE` and confirm a signup attempt returns 503.

- [ ] **Step 6: Commit**

```bash
git add docs/DEPLOYMENT.md docs/DECISIONS.md
git commit -m "docs: DEC-029 invite-gated signup + deployment notes

Records the DEC-018 reversal, the shared-invite-code rationale, and the
LANDLORD_EMAIL-must-be-lowercase deploy hazard introduced by normalizing
email at the schema boundary."
```

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| R1 valid code ⇒ account + logged in + empty tenant | 3, 5 |
| R2 invite code required, generic failure | 2, 3 |
| R3 unset env ⇒ signup unavailable | 2, 3 |
| R4 collects code/email/password/first/last; syncs `name` | 1, 3, 5 |
| R5 min 8 chars, no composition rules | 1 |
| R6 case-insensitive email, signup and login | 1, 3 |
| R7 duplicate email fails specifically, first account intact | 3 |
| R8 `LANDLORD` role, tenant isolation | 3 |
| R9 rate-limited tighter than login | 3 |
| R10 password/invite absent from logs | 3 |
| R11 toggle between forms; en + zh | 5 |
| AE5 seeded landlord still logs in | 3 (Step 5) |
