# Operator-Issued Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator hand a locked-out landlord a single-use, one-hour link that resets their password, without editing the database by hand and without sending an email.

**Architecture:** The token is derived, never stored — an HMAC over `userId:expiresAtMs:passwordHash`, so consuming it (which writes a new hash) invalidates it for free. No table and no migration. A local `tsx` script issues links, because the app has no administrator role and any in-app issuing screen would let one landlord take over another's account. A public endpoint consumes them, returning one identical error for every possible failure.

**Tech Stack:** Node `crypto` HMAC, `@oslojs/encoding`, Fastify 5, Prisma, Zod 4, React 19 + React Router 7, Vitest.

**Spec:** `docs/brainstorms/2026-08-10-password-reset-requirements.md`

## Global Constraints

- **Node 20 is the shell default and breaks Prisma and the test tooling.** Start any shell with:
  `export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"` — confirm `node -v` prints `v24.12.0`.
- **NEVER run the api suite without the local DATABASE_URL override.** The repo-root `.env` `DATABASE_URL` points at the **production** database. Only correct form:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api`
  Web and shared are safe alone: `npm test -w @mac-invoices/web`, `npm test -w @mac-invoices/shared`.
- **Never run `npm run test` from the repo root.** **Never run migrations, `db:deploy`, or `db:push`** — this plan adds no schema change, by design.
- **Commits go directly on `main`.** No feature branch. Do not push — the user pushes when they ask.
- **The repo owner commits to this same tree concurrently.** Never `git add -A`, `git add .`, or `git commit -a` — stage only the files your task names. `.claude/` and `.superpowers/` exist here and must never be committed. Leave any uncommitted owner work alone.
- Definition of Done: `npm run lint && npm run typecheck` green, plus the api, web, and shared suites.
- `npm run format:check` fails on ~70 files for pre-existing reasons and CI gates only lint/typecheck/test — do **not** sweep those. Files you create, or that were clean before you touched them, must stay clean (`npx prettier --check <file>`).
- **Known pre-existing test noise, not yours to fix:** `backfill-invoice-items.test.ts` fails in most full-suite runs and passes in isolation; there is also a shared-landlord login race. If a file fails, re-run it alone before investigating.
- **Error code and message, exactly:** `INVALID_RESET_LINK`, status **400**, message `That reset link is invalid or has expired. Ask for a new one.` — used for every failure that depends on the TOKEN or the ACCOUNT (bad shape, unknown account, tampered, expired, already consumed), which is what stops the endpoint being an account-existence oracle. Body-shape validation failures deliberately keep their own `VALIDATION_ERROR`: they describe the caller's own request, reveal nothing about accounts, and telling someone their link is broken because their password was too short would send them back for a new link that fails identically.
- **Misconfiguration code, exactly:** `RESET_LINK_KEY_INVALID`, status **500**.
- **Token format, exactly:** `rst_<userId>.<expiresAtMs>.<base64url-mac>`.
- **TTL:** one hour.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/auth/resetToken.ts` | **Create.** Pure token build/parse/verify + the key loader. No DB, no HTTP. |
| `apps/api/test/auth.reset-token.test.ts` | **Create.** Unit tests for the above. |
| `packages/shared/src/schemas/auth.ts` | **Modify.** `ResetPasswordSchema` (API contract) + `ResetPasswordFormSchema` (client-only, adds confirm). |
| `packages/shared/test/auth.test.ts` | **Modify.** Schema tests. |
| `apps/api/src/auth/routes.ts` | **Modify.** `POST /api/auth/reset-password`. |
| `apps/api/test/auth.reset-password.test.ts` | **Create.** AE1–AE6. Raises the rate cap so its own calls don't trip it. |
| `apps/api/test/auth.reset-limit.test.ts` | **Create.** AE10, in its own file with its own app instance and a cap of 2. |
| `apps/api/src/auth/resetLink.ts` | **Create.** `resetLinkFor(prisma, email, origin)` — the issuing logic, testable without a terminal. |
| `apps/api/prisma/reset-link.ts` | **Create.** The thin CLI wrapper. |
| `apps/api/test/auth.reset-link.test.ts` | **Create.** AE9 and the lookup behavior. |
| `apps/web/src/pages/ResetPassword.tsx` | **Create.** The public reset page. |
| `apps/web/src/hooks/useAuth.ts` | **Modify.** `useResetPassword`. |
| `apps/web/src/main.tsx:33` | **Modify.** Public route, sibling of `/login`. |
| `apps/web/test/ResetPassword.test.tsx` | **Create.** AE7, AE8. |
| `.env.example`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `package.json`, `apps/api/package.json` | **Modify.** Env var, runbook, DEC, script wiring. |

**Two spec questions resolved here:**
1. *Where do the token helpers live?* A new `apps/api/src/auth/resetToken.ts`, mirroring `apps/api/src/vendors/token.ts` being its own module. Keeping it out of `session.ts` means the pure crypto is unit-testable with no session machinery in scope.
2. *Where does the script live?* `apps/api/prisma/reset-link.ts`, beside `seed.ts`, `backfill-events.ts`, and `sweep-orphan-blobs.ts`. `prisma/` is an odd name for an auth script, but it is unambiguously where this repo already keeps one-off `tsx` scripts — `sweep-orphan-blobs.ts` is no more Prisma-specific. Following the existing convention beats inventing a second location.

---

### Task 1: The derived token

**Files:**
- Create: `apps/api/src/auth/resetToken.ts`
- Create: `apps/api/test/auth.reset-token.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AppError` from `apps/api/src/middleware/errorHandler`.
- Produces, all from `apps/api/src/auth/resetToken.ts`:
  - `RESET_TTL_MS: number` (3600000)
  - `buildResetToken(userId: string, passwordHash: string, expiresAtMs: number): string`
  - `type ParsedResetToken = { userId: string; expiresAtMs: number; mac: string }`
  - `parseResetToken(raw: unknown): ParsedResetToken | null`
  - `resetTokenMatches(parsed: ParsedResetToken, passwordHash: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/auth.reset-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

// Set before the helpers read it — `resetKey()` reads process.env lazily, at
// call time, so a plain top-level assignment is enough (no vi.hoisted needed).
process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'

import {
  buildResetToken,
  parseResetToken,
  resetTokenMatches,
  RESET_TTL_MS,
} from '../src/auth/resetToken'

const USER = 'clx0000000000000000000000'
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$0123456789abcdef'
const future = () => Date.now() + RESET_TTL_MS

describe('reset token', () => {
  it('round-trips: a freshly built token parses and matches its own hash', () => {
    const exp = future()
    const parsed = parseResetToken(buildResetToken(USER, HASH, exp))!
    expect(parsed.userId).toBe(USER)
    expect(parsed.expiresAtMs).toBe(exp)
    expect(resetTokenMatches(parsed, HASH)).toBe(true)
  })

  // This is what buys single-use with no table: consuming a link writes a new
  // hash, so the old mac stops verifying. If this test ever goes green-to-red,
  // reset links have silently become replayable.
  it('stops matching once the password hash changes', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, future()))!
    expect(resetTokenMatches(parsed, `${HASH}-rotated`)).toBe(false)
  })

  it('rejects a tampered mac', () => {
    const token = buildResetToken(USER, HASH, future())
    const parsed = parseResetToken(token)!
    expect(resetTokenMatches({ ...parsed, mac: `${parsed.mac.slice(0, -1)}A` }, HASH)).toBe(false)
  })

  it('rejects a tampered user id', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, future()))!
    expect(resetTokenMatches({ ...parsed, userId: 'clx1111111111111111111111' }, HASH)).toBe(false)
  })

  it('rejects a tampered expiry (extending your own link must not work)', () => {
    const parsed = parseResetToken(buildResetToken(USER, HASH, future()))!
    expect(resetTokenMatches({ ...parsed, expiresAtMs: parsed.expiresAtMs + 86_400_000 }, HASH)).toBe(
      false,
    )
  })

  it('parses nothing but the exact shape', () => {
    expect(parseResetToken(null)).toBeNull()
    expect(parseResetToken(42)).toBeNull()
    expect(parseResetToken('')).toBeNull()
    expect(parseResetToken('nope')).toBeNull()
    expect(parseResetToken(`rst_${USER}.notanumber.abc`)).toBeNull()
    expect(parseResetToken(`rst_${USER}.123`)).toBeNull() // too few parts
    expect(parseResetToken(`rst_.123.abc`)).toBeNull() // empty user id
  })

  it('refuses to derive anything when the key is missing or too short', () => {
    const saved = process.env.RESET_LINK_KEY
    try {
      delete process.env.RESET_LINK_KEY
      expect(() => buildResetToken(USER, HASH, future())).toThrowError(/RESET_LINK_KEY/)
      process.env.RESET_LINK_KEY = 'too-short'
      expect(() => buildResetToken(USER, HASH, future())).toThrowError(/RESET_LINK_KEY/)
    } finally {
      process.env.RESET_LINK_KEY = saved
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-token
```
Expected: FAIL — cannot resolve `../src/auth/resetToken`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/auth/resetToken.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { encodeBase64urlNoPadding } from '@oslojs/encoding'
import { AppError } from '../middleware/errorHandler'

// Operator-issued password-reset links. The token is DERIVED, never stored:
// `rst_<userId>.<expiresAtMs>.<mac>`, where the mac signs
// `userId:expiresAtMs:passwordHash`.
//
// Including the CURRENT password hash is what makes a link single-use without a
// table: consuming it writes a new hash, so the old mac no longer verifies, and
// issuing a second link likewise retires the first. Argon2id salts per call, so
// even re-using the same password produces a different hash and still kills the
// link. This mirrors the vendor-link idiom (DEC-034), where `tokenVersion`
// plays the role the password hash plays here.

const PREFIX = 'rst_'

/** One hour. Encoded in the token and signed, so it cannot be extended. */
export const RESET_TTL_MS = 1000 * 60 * 60

function resetKey(): Buffer {
  const raw = process.env.RESET_LINK_KEY
  if (!raw || raw.length < 32) {
    // Named and actionable rather than a generic INTERNAL_ERROR: this is a
    // deployment misconfiguration, and a 500 with no clue sends the operator
    // hunting through logs for what is a one-line env fix (the DEC-034 lesson).
    throw new AppError(
      'RESET_LINK_KEY_INVALID',
      'RESET_LINK_KEY is missing or shorter than 32 characters, so password-reset links cannot be derived. Set it in the environment and redeploy.',
      500,
    )
  }
  return Buffer.from(raw, 'utf8')
}

function mac(userId: string, expiresAtMs: number, passwordHash: string): string {
  const digest = createHmac('sha256', resetKey())
    .update(`${userId}:${expiresAtMs}:${passwordHash}`)
    .digest()
  return encodeBase64urlNoPadding(new Uint8Array(digest))
}

/** The full link token for `userId`, valid until `expiresAtMs`. Recomputable. */
export function buildResetToken(userId: string, passwordHash: string, expiresAtMs: number): string {
  return `${PREFIX}${userId}.${expiresAtMs}.${mac(userId, expiresAtMs, passwordHash)}`
}

export type ParsedResetToken = { userId: string; expiresAtMs: number; mac: string }

/**
 * Split the token, or null for ANY shape problem — so a malformed token is
 * rejected before it can cost a database read.
 */
export function parseResetToken(raw: unknown): ParsedResetToken | null {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null
  const parts = raw.slice(PREFIX.length).split('.')
  if (parts.length !== 3) return null
  const [userId, expiresRaw, macPart] = parts
  if (!userId || !macPart || !/^\d+$/.test(expiresRaw)) return null
  return { userId, expiresAtMs: Number(expiresRaw), mac: macPart }
}

/** Constant-time check that `parsed` signs exactly this password hash. */
export function resetTokenMatches(parsed: ParsedResetToken, passwordHash: string): boolean {
  const expected = Buffer.from(mac(parsed.userId, parsed.expiresAtMs, passwordHash), 'utf8')
  const actual = Buffer.from(parsed.mac, 'utf8')
  // Length-check first: timingSafeEqual THROWS on unequal lengths, and
  // branching on length leaks nothing here (the mac's length is fixed and
  // public) — same reasoning as the invite-code compare in DEC-029(a).
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
```

- [ ] **Step 4: Run them to verify they pass**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-token
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Document the new env var**

In `.env.example`, add beside the other secrets:

```
# Signing key for operator-issued password-reset links (>=32 chars).
# Generate with: openssl rand -base64 32
# Deliberately NOT the same value as VENDOR_LINK_KEY — separate purposes must
# not share a key, or one leak compromises both.
RESET_LINK_KEY=
```

Also add it to your local repo-root `.env` (any 32+ character string) so the api suite can derive tokens. Do not commit `.env`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/resetToken.ts apps/api/test/auth.reset-token.test.ts .env.example
git commit -m "feat(api): derive single-use password-reset tokens

Signs userId:expiresAt:passwordHash, so consuming a link — which writes a new
hash — invalidates it with no table, no usedAt column, and no expiry sweep.
Issuing a second link retires the first for the same reason.

Mirrors the vendor-link derivation (DEC-034), where tokenVersion plays the role
the password hash plays here."
```

---

### Task 2: The reset endpoint

**Files:**
- Modify: `packages/shared/src/schemas/auth.ts`
- Modify: `packages/shared/test/auth.test.ts`
- Modify: `apps/api/src/auth/routes.ts`
- Create: `apps/api/test/auth.reset-password.test.ts`

**Interfaces:**
- Consumes: `buildResetToken`, `parseResetToken`, `resetTokenMatches`, `RESET_TTL_MS` from Task 1; `hashPassword` from `apps/api/src/auth/password`.
- Produces:
  - `ResetPasswordSchema` / `ResetPasswordInput` — `{ token: string; newPassword: string }`, exported from `@mac-invoices/shared`.
  - `ResetPasswordFormSchema` / `ResetPasswordFormInput` — client-only, `{ newPassword, confirmPassword }` with an equality refinement pathed to `confirmPassword`.
  - `POST /api/auth/reset-password` → **204** on success.

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/shared/test/auth.test.ts` (merge into the existing import from `../src/schemas/auth` rather than adding a second one):

```ts
describe('ResetPasswordSchema', () => {
  it('accepts a token and a long-enough password', () => {
    const parsed = ResetPasswordSchema.parse({ token: 'rst_abc.1.xyz', newPassword: 'a-good-one' })
    expect(parsed.newPassword).toBe('a-good-one')
  })

  it('rejects a password under 8 characters, matching the Settings floor', () => {
    expect(
      ResetPasswordSchema.safeParse({ token: 'rst_abc.1.xyz', newPassword: 'short' }).success,
    ).toBe(false)
  })

  it('rejects an empty token', () => {
    expect(ResetPasswordSchema.safeParse({ token: '', newPassword: 'a-good-one' }).success).toBe(
      false,
    )
  })
})

describe('ResetPasswordFormSchema', () => {
  it('blocks mismatched passwords and paths the error at the confirmation', () => {
    const result = ResetPasswordFormSchema.safeParse({
      newPassword: 'a-good-one',
      confirmPassword: 'a-different-one',
    })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].path).toEqual(['confirmPassword'])
    expect(result.error!.issues[0].message).toBe('Passwords do not match')
  })

  it('accepts a matching pair', () => {
    expect(
      ResetPasswordFormSchema.safeParse({
        newPassword: 'a-good-one',
        confirmPassword: 'a-good-one',
      }).success,
    ).toBe(true)
  })

  // The token comes from the URL fragment, never the form — so the client
  // schema must not require it.
  it('does not require a token', () => {
    expect(Object.keys(ResetPasswordFormSchema.safeParse({}).error!.flatten().fieldErrors)).not.toContain(
      'token',
    )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @mac-invoices/shared -- auth`
Expected: FAIL — `ResetPasswordSchema` is not exported.

- [ ] **Step 3: Add the schemas**

Append to `packages/shared/src/schemas/auth.ts`:

```ts
// Consuming an operator-issued reset link. The token rides in the URL fragment
// and is posted in the body; the 8-character floor matches ChangePasswordSchema
// so the two password-setting paths cannot drift apart.
export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>

// Client-only: what the reset FORM validates. It deliberately has no `token` —
// that comes from the fragment, not from anything the user types — and adds the
// confirmation field (DEC-031). The API contract above never sees it.
export const ResetPasswordFormSchema = ResetPasswordSchema.omit({ token: true })
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type ResetPasswordFormInput = z.infer<typeof ResetPasswordFormSchema>
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -w @mac-invoices/shared`
Expected: PASS, all files.

- [ ] **Step 5: Write the failing endpoint tests**

Create `apps/api/test/auth.reset-password.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Read lazily by resetKey(), so a top-level assignment is enough.
process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'
// This file makes well over the production cap of 10 reset calls from one IP.
// Without this the suite would 429 partway through and look like a broken
// endpoint. The cap itself is covered separately, in auth.reset-limit.test.ts.
process.env.RESET_RATE_LIMIT_MAX = '500'

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'
import { buildResetToken, RESET_TTL_MS } from '../src/auth/resetToken'
import { verifyPassword } from '../src/auth/password'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

const reset = (token: string, newPassword: string) =>
  app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword } })

/** A throwaway user plus a live link for them. */
async function userWithLink(ttlMs = RESET_TTL_MS) {
  const u = await createSecondUser(app)
  const row = await app.prisma.user.findUniqueOrThrow({
    where: { id: u.user.id },
    select: { passwordHash: true },
  })
  const token = buildResetToken(u.user.id, row.passwordHash, Date.now() + ttlMs)
  return { ...u, token }
}

const INVALID = 'That reset link is invalid or has expired. Ask for a new one.'

describe('POST /api/auth/reset-password', () => {
  it('sets the password, kills every session, and the new password logs in (AE1)', async () => {
    const u = await userWithLink()
    try {
      const res = await reset(u.token, 'brand-new-password')
      expect(res.statusCode).toBe(204)

      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true, email: true },
      })
      expect(await verifyPassword(row.passwordHash, 'brand-new-password')).toBe(true)
      expect(await app.prisma.session.count({ where: { userId: u.user.id } })).toBe(0)

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: row.email, password: 'brand-new-password' },
      })
      expect(login.statusCode).toBe(200)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses a link that has already been used (AE2)', async () => {
    const u = await userWithLink()
    try {
      expect((await reset(u.token, 'first-new-password')).statusCode).toBe(204)
      const again = await reset(u.token, 'second-new-password')
      expect(again.statusCode).toBe(400)
      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      // Still the FIRST reset's password — the replay changed nothing.
      expect(await verifyPassword(row.passwordHash, 'first-new-password')).toBe(true)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses an expired link (AE3)', async () => {
    const u = await userWithLink(-1000) // already expired
    try {
      expect((await reset(u.token, 'brand-new-password')).statusCode).toBe(400)
    } finally {
      await u.cleanup()
    }
  })

  it('refuses a tampered link (AE4)', async () => {
    const u = await userWithLink()
    try {
      const tampered = `${u.token.slice(0, -1)}${u.token.endsWith('A') ? 'B' : 'A'}`
      expect((await reset(tampered, 'brand-new-password')).statusCode).toBe(400)
    } finally {
      await u.cleanup()
    }
  })

  it('returns byte-identical responses for every failure mode (AE5)', async () => {
    const u = await userWithLink()
    let expired: string
    try {
      expired = buildResetToken(u.user.id, 'whatever', Date.now() - 1000)
      const unknownUser = buildResetToken('clx9999999999999999999999', 'whatever', Date.now() + RESET_TTL_MS)
      const tampered = `${u.token.slice(0, -1)}${u.token.endsWith('A') ? 'B' : 'A'}`
      const malformed = 'not-even-close'

      const bodies = []
      for (const t of [expired, unknownUser, tampered, malformed]) {
        const res = await reset(t, 'brand-new-password')
        bodies.push({ status: res.statusCode, body: res.body })
      }
      // No response may hint at WHICH thing was wrong — otherwise the endpoint
      // becomes an oracle for which accounts exist.
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
      expect(bodies[0].status).toBe(400)
      expect(JSON.parse(bodies[0].body).error.code).toBe('INVALID_RESET_LINK')
      expect(JSON.parse(bodies[0].body).error.message).toBe(INVALID)
    } finally {
      await u.cleanup()
    }
  })

  it('retires the older link when a newer one is issued (AE6)', async () => {
    const u = await createSecondUser(app)
    try {
      const before = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const older = buildResetToken(u.user.id, before.passwordHash, Date.now() + RESET_TTL_MS)
      // Using the older link rotates the hash, which is exactly what retires it.
      expect((await reset(older, 'password-from-older')).statusCode).toBe(204)

      const mid = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const newer = buildResetToken(u.user.id, mid.passwordHash, Date.now() + RESET_TTL_MS)
      expect((await reset(older, 'should-not-work')).statusCode).toBe(400)
      expect((await reset(newer, 'password-from-newer')).statusCode).toBe(204)
    } finally {
      await u.cleanup()
    }
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-password
```
Expected: FAIL — the route does not exist, so every call returns **404** from the not-found handler (AE5 will report a set size of 1 but a status of 404, which is why it also asserts 400 explicitly).

- [ ] **Step 7: Add the endpoint**

In `apps/api/src/auth/routes.ts`, extend the existing shared import to include the new schema:

```ts
import { LoginSchema, SignupSchema, ResetPasswordSchema } from '@mac-invoices/shared'
```

and add the token helpers beside the existing local imports:

```ts
import { parseResetToken, resetTokenMatches } from './resetToken'
```

Then add this route inside `authRoutes`, after the signup route:

```ts
  /**
   * POST /api/auth/reset-password — consume an operator-issued reset link.
   *
   * PUBLIC by necessity: the caller is locked out, so there is no session to
   * authenticate. Authorization is the token, exactly as it is for a vendor
   * submission link.
   *
   * EVERY failure returns the identical response. Distinguishing "no such
   * account" from "expired" from "tampered" would turn this into an oracle for
   * which emails have accounts — the same reasoning as `validateLinkToken`
   * returning null for any failure.
   */
  // Env-overridable exactly like `pwMax` above, and for the same reason: the
  // tests in `auth.reset-password.test.ts` make well over ten reset calls from
  // one IP, so a hard-coded cap would 429 the suite partway through and look
  // like a broken endpoint. Production leaves it at 10.
  const resetMax = Number(process.env.RESET_RATE_LIMIT_MAX ?? 10)

  app.post(
    '/api/auth/reset-password',
    { config: { rateLimit: { max: resetMax, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { token, newPassword } = parseBody(ResetPasswordSchema, request.body)
      const invalid = () =>
        new AppError(
          'INVALID_RESET_LINK',
          'That reset link is invalid or has expired. Ask for a new one.',
          400,
        )

      const parsed = parseResetToken(token)
      if (!parsed) throw invalid()
      if (parsed.expiresAtMs < Date.now()) throw invalid()

      const user = await request.server.prisma.user.findUnique({
        where: { id: parsed.userId },
        select: { id: true, passwordHash: true },
      })
      if (!user) throw invalid()
      if (!resetTokenMatches(parsed, user.passwordHash)) throw invalid()

      const passwordHash = await hashPassword(newPassword)
      await request.server.prisma.$transaction([
        request.server.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        // ALL sessions die — deliberately unlike the Settings password change,
        // which keeps the caller's own alive (KTD-2). There is no caller session
        // here, and if an attacker holds one, this is exactly when it should end.
        request.server.prisma.session.deleteMany({ where: { userId: user.id } }),
      ])
      return reply.code(204).send()
    },
  )
```

`AppError`, `parseBody`, and `hashPassword` are already imported at the top of this file — do not add duplicate imports.

- [ ] **Step 8: Run them to verify they pass**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-password
```
Expected: PASS, 6 tests.

- [ ] **Step 9: Cover the rate limit in its own file (AE10)**

It needs a separate file because the limiter's counter is per app instance, and the behavior test above deliberately raises the cap to 500. Create `apps/api/test/auth.reset-limit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'
// A small cap so the limit is reachable in a handful of calls. This file gets
// its own app instance, so it cannot affect the behavior tests' counter.
process.env.RESET_RATE_LIMIT_MAX = '2'

import { buildApp } from '../src/app'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('reset-password rate limit', () => {
  it('starts refusing once the cap is exceeded (AE10)', async () => {
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        // Deliberately a junk token: this asserts the LIMITER, and a junk token
        // exercises it without needing a real account. Under the cap it must be
        // the ordinary 400, not a 429.
        payload: { token: 'rst_nope.1.nope', newPassword: 'a-good-password' },
      })

    expect((await call()).statusCode).toBe(400)
    expect((await call()).statusCode).toBe(400)

    const limited = await call()
    expect(limited.statusCode).toBe(429)
    // The app's own envelope, not the plugin's default body.
    expect(limited.json().error.code).toBe('TOO_MANY_REQUESTS')
  })
})
```

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-limit
```
Expected: PASS. If the third call returns 400 rather than 429, the route is not reading `RESET_RATE_LIMIT_MAX` — check Step 7.

- [ ] **Step 10: Run lint, typecheck, and the full suites**

Run:
```bash
npm run lint && npm run typecheck
npm test -w @mac-invoices/shared
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api
```
Expected: green apart from the documented pre-existing noise.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/schemas/auth.ts packages/shared/test/auth.test.ts \
  apps/api/src/auth/routes.ts apps/api/test/auth.reset-password.test.ts \
  apps/api/test/auth.reset-limit.test.ts
git commit -m "feat(api): consume a reset link at POST /api/auth/reset-password

Public by necessity — the caller is locked out, so the token is the
authorization, as it is for a vendor submission link.

Every failure returns one identical response. Telling 'no such account' apart
from 'expired' or 'tampered' would make this an oracle for which emails have
accounts.

Resetting destroys every session for that user, unlike the Settings change which
keeps the caller's own alive: there is no caller session here, and if someone
else holds one this is precisely when it should end."
```

---

### Task 3: Issuing a link

**Files:**
- Create: `apps/api/src/auth/resetLink.ts`
- Create: `apps/api/prisma/reset-link.ts`
- Create: `apps/api/test/auth.reset-link.test.ts`
- Modify: `apps/api/package.json`, `package.json`

**Interfaces:**
- Consumes: `buildResetToken`, `RESET_TTL_MS` from Task 1.
- Produces: `resetLinkFor(prisma: PrismaClient, email: string, origin: string): Promise<{ url: string; expiresAt: Date } | null>` from `apps/api/src/auth/resetLink.ts`; the npm script `auth:reset-link`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/auth.reset-link.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

process.env.RESET_LINK_KEY = 'test-reset-link-key-at-least-32-chars'

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'
import { resetLinkFor } from '../src/auth/resetLink'
import { parseResetToken, resetTokenMatches } from '../src/auth/resetToken'

const app = buildApp()
beforeAll(async () => {
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

const ORIGIN = 'https://mac-invoices.vercel.app'

describe('resetLinkFor', () => {
  it('issues a link whose token verifies against the account', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = (await resetLinkFor(app.prisma, u.user.email, ORIGIN))!
      expect(issued).not.toBeNull()
      expect(issued.url.startsWith(`${ORIGIN}/reset-password#t=rst_`)).toBe(true)
      expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now())

      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const parsed = parseResetToken(issued.url.split('#t=')[1])!
      expect(parsed.userId).toBe(u.user.id)
      expect(resetTokenMatches(parsed, row.passwordHash)).toBe(true)
    } finally {
      await u.cleanup()
    }
  })

  it('matches the account regardless of the email casing typed', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = await resetLinkFor(app.prisma, `  ${u.user.email.toUpperCase()} `, ORIGIN)
      expect(issued).not.toBeNull()
    } finally {
      await u.cleanup()
    }
  })

  // Unlike the public endpoint, this DOES distinguish — the caller is the
  // operator at a terminal, and a silent success would have them send a link
  // that can never work.
  it('returns null for an unknown account', async () => {
    expect(await resetLinkFor(app.prisma, 'nobody-here@example.com', ORIGIN)).toBeNull()
  })

  it('never exposes the password hash or the signing key (AE9)', async () => {
    const u = await createSecondUser(app)
    try {
      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: u.user.id },
        select: { passwordHash: true },
      })
      const issued = (await resetLinkFor(app.prisma, u.user.email, ORIGIN))!
      const printed = `${issued.url} ${issued.expiresAt.toISOString()}`
      expect(printed).not.toContain(row.passwordHash)
      expect(printed).not.toContain(process.env.RESET_LINK_KEY!)
    } finally {
      await u.cleanup()
    }
  })

  it('does not double a trailing slash on the origin', async () => {
    const u = await createSecondUser(app)
    try {
      const issued = (await resetLinkFor(app.prisma, u.user.email, `${ORIGIN}/`))!
      expect(issued.url).toContain(`${ORIGIN}/reset-password#t=`)
      expect(issued.url).not.toContain('//reset-password')
    } finally {
      await u.cleanup()
    }
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-link
```
Expected: FAIL — cannot resolve `../src/auth/resetLink`.

- [ ] **Step 3: Write the issuing logic**

Create `apps/api/src/auth/resetLink.ts`:

```ts
import type { PrismaClient } from '../../prisma/generated/client.ts'
import { buildResetToken, RESET_TTL_MS } from './resetToken'

export type IssuedResetLink = { url: string; expiresAt: Date }

/**
 * Derive a reset link for `email`, or null when no such account exists.
 *
 * This one DOES distinguish a missing account, unlike the public endpoint that
 * consumes the link: the caller here is the operator at their own terminal, and
 * a silent success would have them send someone a link that can never work.
 *
 * Email is normalized the same way `EmailSchema` does (trim + lowercase), so an
 * address typed with different casing still finds the account.
 */
export async function resetLinkFor(
  prisma: PrismaClient,
  email: string,
  origin: string,
): Promise<IssuedResetLink | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true },
  })
  if (!user) return null

  const expiresAt = new Date(Date.now() + RESET_TTL_MS)
  const token = buildResetToken(user.id, user.passwordHash, expiresAt.getTime())
  // Fragment, not a path or query parameter: fragments are not sent in Referer
  // headers and never reach server access logs.
  return { url: `${origin.replace(/\/+$/, '')}/reset-password#t=${token}`, expiresAt }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api -- auth.reset-link
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the CLI wrapper**

Create `apps/api/prisma/reset-link.ts`. Keep it thin — all the logic is in `resetLinkFor`, which is what the tests cover:

```ts
import '../src/lib/loadEnv.ts'
import { prisma } from '../src/lib/prisma'
import { resetLinkFor } from '../src/auth/resetLink'

// Issue a password-reset link for one account:
//   npm run auth:reset-link -- someone@example.com
//
// Deliberately a local script and not an in-app screen: this app has no
// administrator role (every User is a landlord tenant), so an in-app issuer
// would let any landlord take over any other landlord's account. Whoever can
// run this can already edit the database directly, so it grants nothing new.

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npm run auth:reset-link -- <email>')
    process.exitCode = 1
    return
  }
  const origin = process.env.WEB_ORIGIN
  if (!origin) {
    console.error('WEB_ORIGIN is not set — cannot build a link. Set it in .env and retry.')
    process.exitCode = 1
    return
  }

  const issued = await resetLinkFor(prisma, email, origin)
  if (!issued) {
    console.error(`No account found for ${email}.`)
    process.exitCode = 1
    return
  }

  console.log(`Reset link for ${email} (expires ${issued.expiresAt.toISOString()}):`)
  console.log(issued.url)
  console.log('\nIt works once. Issuing another link retires this one.')
}

main()
  .catch((err) => {
    // Never print the raw error: RESET_LINK_KEY_INVALID carries a safe message,
    // but an unexpected Prisma error can embed the connection string.
    console.error(err instanceof Error ? err.message : 'Failed to issue a reset link.')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 6: Wire the npm scripts**

In `apps/api/package.json`, beside the other `tsx` one-offs:

```json
    "auth:reset-link": "tsx prisma/reset-link.ts",
```

In the root `package.json`, beside the other delegating scripts:

```json
    "auth:reset-link": "npm run auth:reset-link -w @mac-invoices/api --",
```

- [ ] **Step 7: Verify the script end to end against the LOCAL database**

Run (note the local `DATABASE_URL` — never the default, which is production):

```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" WEB_ORIGIN="http://localhost:5173" \
  npm run auth:reset-link -- landlord@example.com
```
Expected: a `Reset link for … (expires …)` line and an `http://localhost:5173/reset-password#t=rst_…` URL. Confirm the output contains no `$argon2id$` string and no part of `RESET_LINK_KEY`. Then run it with a nonsense email and confirm it prints `No account found` and exits non-zero (`echo $?` → `1`).

If your local landlord's email differs, get it with:
`psql "postgresql://postgres:postgres@localhost:5433/invoices" -tc "SELECT email FROM users LIMIT 1;"`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/resetLink.ts apps/api/prisma/reset-link.ts \
  apps/api/test/auth.reset-link.test.ts apps/api/package.json package.json
git commit -m "feat(api): issue reset links from a local script

A script rather than an in-app screen: the app has no administrator role — every
User is a landlord tenant — so an in-app issuer would hand every invitee the
ability to take over any other account. Whoever can run this can already edit the
database directly, so it grants no new authority.

The logic lives in resetLinkFor() so it is testable without a terminal; the CLI
is a thin wrapper. Unlike the public endpoint, it reports an unknown account,
because a silent success would have the operator send a link that cannot work."
```

---

### Task 4: The reset page, and record the decision

**Files:**
- Create: `apps/web/src/pages/ResetPassword.tsx`
- Modify: `apps/web/src/hooks/useAuth.ts`
- Modify: `apps/web/src/main.tsx:33`
- Create: `apps/web/test/ResetPassword.test.tsx`
- Modify: `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: `POST /api/auth/reset-password` (204 on success) from Task 2; `ResetPasswordFormSchema` / `ResetPasswordFormInput` from Task 2.
- Produces: `useResetPassword()` from `apps/web/src/hooks/useAuth.ts` — a mutation taking `{ token: string; newPassword: string }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/ResetPassword.test.tsx`. Follow the mocking style of `apps/web/test/Signup.test.tsx` (which mocks `@/hooks/useAuth` wholesale):

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ResetPassword from '@/pages/ResetPassword'

const resetMutate = vi.fn()
vi.mock('@/hooks/useAuth', () => ({
  useResetPassword: () => ({ mutate: resetMutate, isPending: false, error: null }),
}))

const withHash = (hash: string) => {
  window.location.hash = hash
}

beforeEach(() => {
  vi.clearAllMocks()
  withHash('#t=rst_abc.123.xyz')
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  )

describe('ResetPassword', () => {
  // The page is a sibling of /login, outside AuthGuard — a locked-out user has
  // no session, so requiring one would make it useless.
  it('renders for a visitor with no session (AE8)', () => {
    renderPage()
    expect(screen.getByLabelText('New password')).toBeTruthy()
    expect(screen.getByLabelText('Confirm new password')).toBeTruthy()
  })

  it('submits the token from the URL fragment with the new password', async () => {
    renderPage()
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-good-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(resetMutate).toHaveBeenCalled())
    expect(resetMutate.mock.calls[0][0]).toEqual({
      token: 'rst_abc.123.xyz',
      newPassword: 'a-good-password',
    })
  })

  it('blocks submission when the two passwords differ (AE7)', async () => {
    renderPage()
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeTruthy())
    expect(resetMutate).not.toHaveBeenCalled()
  })

  it('tells a visitor arriving with no token that the link is unusable', () => {
    withHash('')
    renderPage()
    expect(screen.getByRole('alert').textContent).toMatch(/link/i)
    expect(screen.queryByRole('button', { name: 'Set new password' })).toBeNull()
  })

  // jsdom has no autofill; this asserts the signal the app sends, per DEC-031.
  it('marks both password fields so saved credentials are not offered', () => {
    renderPage()
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Confirm new password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @mac-invoices/web -- ResetPassword`
Expected: FAIL — cannot resolve `@/pages/ResetPassword`.

- [ ] **Step 3: Add the hook**

In `apps/web/src/hooks/useAuth.ts`, add beside the existing `useLogin` / `useSignup` (reusing the imports already in that file):

```ts
/** Consume an operator-issued reset link. No session involved — the token is
 *  the authorization, and a 204 means the password is set. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (body: { token: string; newPassword: string }) =>
      apiClient<void>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  })
}
```

If `useMutation` or `apiClient` is not already imported in that file, add it to the existing import statement rather than writing a new one.

- [ ] **Step 4: Add the page**

Create `apps/web/src/pages/ResetPassword.tsx`:

```tsx
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { ResetPasswordFormSchema, type ResetPasswordFormInput } from '@mac-invoices/shared'
import { ApiError } from '@/lib/apiClient'
import { useResetPassword } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { fieldClass } from '@/components/auth/authField'

/**
 * Public reset page — a sibling of /login, outside AuthGuard, because the
 * person using it is by definition locked out.
 *
 * The token arrives in the URL FRAGMENT, not a path or query parameter:
 * fragments are not sent in Referer headers and never reach server access logs.
 * It is read once at module scope of the render, then posted in the body.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const reset = useResetPassword()
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? ''

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormInput>({
    resolver: zodResolver(ResetPasswordFormSchema) as Resolver<ResetPasswordFormInput>,
  })

  const serverError =
    reset.error instanceof ApiError
      ? reset.error.message
      : reset.error
        ? 'Something went wrong. Please try again.'
        : null

  if (!token) {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Reset your password</h1>
        <p className="text-sm text-destructive" role="alert">
          This reset link is incomplete. Ask for a new link.
        </p>
      </div>
    )
  }

  const onSubmit = handleSubmit(({ newPassword }) => {
    reset.mutate(
      { token, newPassword },
      // Straight to login rather than auto-signing them in: the reset destroyed
      // every session for this account, and proving the new password works is
      // the point of the exercise.
      { onSuccess: () => navigate('/login', { replace: true }) },
    )
  })

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-4 text-2xl font-bold text-foreground">Reset your password</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="newPassword" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            // "new-password", not "off": browsers ignore `off` on password
            // inputs (DEC-031).
            autoComplete="new-password"
            className={fieldClass}
            {...register('newPassword')}
          />
          {errors.newPassword && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            className={fieldClass}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {serverError && (
          <p className="text-sm text-destructive" role="alert" aria-live="polite">
            {serverError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? 'Setting…' : 'Set new password'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Register the route**

In `apps/web/src/main.tsx`, add the import beside the other page imports:

```tsx
import ResetPassword from './pages/ResetPassword.tsx'
```

and the route as a sibling of `/login`, immediately after the `/submit/:token` entry:

```tsx
  // Public reset page — outside AuthGuard, because the person using it is
  // locked out by definition. The token is in the fragment, so it never
  // reaches the server's access logs.
  { path: '/reset-password', element: <ResetPassword /> },
```

- [ ] **Step 6: Run the web tests to verify they pass**

Run: `npm test -w @mac-invoices/web -- ResetPassword`
Expected: PASS, 5 tests.

- [ ] **Step 7: Record the decision**

Append to `docs/DECISIONS.md`, matching the existing flat bullet format (`- **DEC-0NN — Title** (plan: ..., spec: ...). (a) ... (b) ...`). **Check the highest existing number first** — `grep -oE '\*\*DEC-0[0-9]+ —' docs/DECISIONS.md | sort -u | tail -1` — and use the next free one. It was DEC-035 when this plan was written, so this is expected to be **DEC-036**; the repo owner commits concurrently, so verify rather than assume. Use that number consistently in the text below and in your commit message.

```markdown
- **DEC-036 — Password reset is an operator-issued, derived, single-use link; no email and no admin role** (plan: `docs/plans/2026-08-10-001-feat-password-reset-plan.md`, spec: `docs/brainstorms/2026-08-10-password-reset-requirements.md`). **Closes the recovery half of DEC-029(c)**; its no-email-verification half stays open. (a) **No email, by design — not deferred pending configuration.** `RESEND_API_KEY` has never been set in Vercel, so `sendEmail()` throws `EMAIL_NOT_CONFIGURED` and `digest.ts`'s `catch { failed++ }` hides it; production email has never delivered and nothing said so. Reaching any recipient other than the Resend account owner also requires verifying a sending domain, which the user declined to register. A reset built on email would have shipped inert while looking functional. (b) **A local script issues links, not an in-app screen.** `Role` is `LANDLORD | VENDOR` and every `User` is a tenant, so an in-app issuer would let any invited landlord take over any other landlord's account — a privilege-escalation hole worse than the lockout it fixes. Whoever can run the script can already edit the database directly, so it grants no new authority. Rejected: inventing an `ADMIN` role plus an authenticated endpoint whose purpose is minting account-takeover links, to buy the ability to issue from a phone. (c) **The token is derived, never stored** — `HMAC-SHA256(RESET_LINK_KEY, "userId:expiresAtMs:passwordHash")` — so there is no table, no migration, no `usedAt` column, and no expiry sweep. (d) **Including the current password hash makes it single-use for free**: consuming a link writes a new hash, so the old mac stops verifying, and issuing a second link retires the first. Argon2id salts per call, so re-using the same password still rotates the hash and still kills the link. This mirrors DEC-034's vendor links, where `tokenVersion` plays the same role. (e) **A separate `RESET_LINK_KEY`**, never `VENDOR_LINK_KEY` — distinct purposes must not share a key. Unset or under 32 characters fails closed with the named `RESET_LINK_KEY_INVALID`, following DEC-034's lesson that a generic 500 sends the operator hunting for a one-line env fix. (f) **Every failure returns one identical response** (`INVALID_RESET_LINK`, 400) — bad shape, unknown account, tampered, expired, already used. Anything finer turns the endpoint into an oracle for which emails have accounts, the same reasoning as `validateLinkToken` returning null for any failure. (g) **The token rides in the URL fragment**, not a path or query parameter, so it is absent from `Referer` headers and from server access logs; the logger's `req` serializer records no body, so posting it leaks nothing either. `/submit/:token` uses a path parameter, which is a fair trade for a shareable vendor link and the wrong one here. (h) **Consuming a link destroys every session for that account**, deliberately unlike the Settings password change which keeps the caller's own alive (KTD-2): there is no caller session here, and if an attacker holds one this is exactly when it should end. (i) **Not addressed:** self-service recovery (a landlord must reach the operator, which fits DEC-029's "handful of personally-known invitees"), and an account created with a mistyped email — this recovers by identity, not by email, so a wrong address is still a hand-repair.
```

- [ ] **Step 8: Document the new env var**

In `docs/DEPLOYMENT.md` §5, add `RESET_LINK_KEY` to the required-variables table beside `VENDOR_LINK_KEY`, with this description:

```
| `RESET_LINK_KEY` | signing key for operator-issued password-reset links; ≥32 chars, generate with `openssl rand -base64 32`. Must NOT reuse `VENDOR_LINK_KEY` — separate purposes must not share a key. Unset ⇒ `POST /api/auth/reset-password` fails with `RESET_LINK_KEY_INVALID` (500) and no link can be issued. |
```

Then add a short subsection after the vendor-link material explaining the operator workflow:

```markdown
### Issuing a password reset (2026-08-10)

A landlord who forgets their password has no self-service route — there is no
deliverable email (see DEC-036(a)) and no admin UI (DEC-036(b)). Recovery is:

```bash
npm run auth:reset-link -- someone@example.com
```

run against the environment whose database holds the account, with `WEB_ORIGIN`
set to that environment's URL. It prints a link valid for one hour that works
exactly once; send it to the person directly. Issuing a second link retires the
first, and using the link signs that account out everywhere.

Against production this reads and writes the live database — the same care as
any other script run with the production `DATABASE_URL`.
```

- [ ] **Step 9: Run everything**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"
npm run lint && npm run typecheck
npm test -w @mac-invoices/shared && npm test -w @mac-invoices/web
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/invoices" LANDLORD_PASSWORD="changeme-dev" npm test -w @mac-invoices/api
```
Expected: green apart from the documented pre-existing noise. Check your own touched files with `npx prettier --check`.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/ResetPassword.tsx apps/web/src/hooks/useAuth.ts \
  apps/web/src/main.tsx apps/web/test/ResetPassword.test.tsx \
  docs/DECISIONS.md docs/DEPLOYMENT.md
git commit -m "feat(web): public reset page, and document the reset decision

The page sits outside AuthGuard because the person using it is locked out by
definition, and reads its token from the URL fragment so it never reaches server
access logs.

On success it sends them to /login rather than auto-signing them in: the reset
destroyed every session for the account, and proving the new password works is
the point."
```

---

## Requirement coverage note

Spec **R11** (the token never reaches `Referer` headers or server access logs) is
structural, not testable here. It holds because the token is in the URL fragment,
which browsers do not transmit, and because the logger's `req` serializer
(`apps/api/src/app.ts:60-67`) records `method`, `url`, `host`, and
`remoteAddress` only — never a request body. That is why the vendor links needed
`redactUrlToken` and this does not: their secret rides in the path. Nothing to
assert in a test; the guard is that the token is never put in a path or query
parameter. If a future change moves it into the URL, `redactUrlToken` would need
extending.

Every other requirement has a task: R1/R12 → Task 3; R2/R3/R4 → Tasks 1 and 2;
R5/R6/R7/R8/R13 → Task 2; R9/R10 → Task 4; R14 → the whole design (no email
module is imported anywhere in this plan).

---

## Post-Implementation

**Before this is useful in production, `RESET_LINK_KEY` must be set in Vercel.** Until then `POST /api/auth/reset-password` returns `RESET_LINK_KEY_INVALID` (500) and no link can be issued. Generate with `openssl rand -base64 32` and add it as a production environment variable, then redeploy — the value is read at request time, but a redeploy is needed for the running functions to see it.

Worth one manual check afterwards: issue a link for a throwaway account against production, confirm it sets the password, confirm the same link then fails, and confirm the account's other sessions are gone.
