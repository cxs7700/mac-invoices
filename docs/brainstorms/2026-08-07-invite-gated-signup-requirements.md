---
date: 2026-08-07
topic: invite-gated-signup
---

# Invite-Gated Landlord Signup — Requirements

## Summary

Replace the disabled "Sign up — Soon" affordance on the auth card with a working signup form that creates a new landlord account, gated by a shared invite code held in an env var. A successful signup creates the user, opens a session, and lands them in the app as a fresh empty tenant. No schema change, no migration, no email round-trip. The env var doubles as the feature flag: unset means signup is off.

---

## Problem Frame

The app has exactly one way to get an account: run the Prisma seed, which upserts a single landlord keyed on a fixed `LANDLORD_USER_ID`. Adding a second landlord today means hand-inserting a row with a `hashPassword()`-derived hash. DEC-018 made this deliberate ("no signup/OAuth"), and the login card already reserves the space — a segmented Log in / Sign up toggle whose second half is an `aria-disabled` span.

The data model is already ready for this. `User.role` defaults to `LANDLORD`, and `Contractor`, `Property`, and `Invoice` all scope by `userId`, so a new user is already a fully isolated tenant. The work is an endpoint, a form, and a gate — not a migration.

One latent defect surfaces the moment a second account exists: `POST /api/auth/login` looks up the user with an exact-match `findUnique` on `email`, and nothing normalizes case anywhere. Today the only email is whatever `LANDLORD_EMAIL` says, so the mismatch never shows. Once users type their own addresses, someone who registers as `Foo@Bar.com` and later types `foo@bar.com` gets "Invalid email or password" with no way to recover — there is no password reset. This is fixed as part of this feature rather than left as a trap.

---

## Key Decisions

- **Invite-code gated, not open signup.** A single shared `SIGNUP_INVITE_CODE` env var, compared in constant time. No `InviteCode` table, no per-invite revocation, no audit trail — the tradeoff is that revoking one person means rotating the code for everyone, which is acceptable while the invitee list is small and personally known. The DB-table design stays available as a later upgrade without changing the endpoint's contract.
- **The env var is the feature flag.** Unset ⇒ the endpoint returns 503 and the signup toggle is unavailable. Preview and production stay closed by default; enabling signup is an env change, not a deploy.
- **No email verification in v1.** The invite code already establishes who may create an account, so verification adds little abuse protection here. Accepted risk: a mistyped email produces an account nobody can log into and nobody can recover, because there is no password reset. Tolerable while every user is personally known; it is the first thing to revisit if that stops being true.
- **Signup logs the user straight in.** It issues a session exactly as login does and returns the same response body, so the web client reuses the existing auth-cache path rather than growing a second shape.
- **Email is normalized to lowercase at the schema boundary, for login as well as signup.** A shared `EmailSchema` trims and lowercases. This changes existing login behavior deliberately: it is what closes the lockout described in the problem frame. The cost is that a `LANDLORD_EMAIL` containing uppercase must be lowercased in the environment, which is verified by a regression test rather than assumed.
- **A duplicate email is reported as such, rather than hidden behind a generic failure.** This is user enumeration, but only for a caller who already holds a valid invite code and has cleared the hourly rate limit — a narrow disclosure to a trusted caller, traded for the visitor knowing to log in instead of retrying. Note that login itself remains deliberately non-enumerating (DEC-018's constant-time dummy verify), and this does not weaken it.
- **Signup is rate-limited far harder than login.** Login allows 10 per 15 minutes; signup allows 5 per hour, because it is an unauthenticated endpoint that creates tenant rows.
- **`Login.tsx` splits into a card shell plus two form components.** The page already carries a full form; hosting a second one inline would roughly double it. The shell owns the toggle and the still-disabled Google button.

---

## Requirements

- R1. A visitor with a valid invite code can create a landlord account from the auth card and is logged in immediately, landing in the app as an empty tenant.
- R2. Signup requires a valid invite code; without one no account is created, and the failure does not reveal whether the code was close, malformed, or merely wrong.
- R3. When no invite code is configured in the environment, signup is unavailable and no account can be created by any request.
- R4. The signup form collects invite code, email, password, first name, and last name. First and last name are required and populate the split name fields plus the combined display name in the same write.
- R5. Passwords must be at least 8 characters, with no character-class composition rules.
- R6. Email addresses are matched case-insensitively for both signup and login, so an account created with any casing can log in with any casing.
- R7. Attempting to sign up with an email that already has an account fails without creating a duplicate or disturbing the existing account, and says so specifically enough that the visitor knows to log in instead.
- R8. New accounts are created with the `LANDLORD` role and see none of any other landlord's properties, contractors, or invoices.
- R9. Signup is rate-limited per client, at a materially tighter threshold than login.
- R10. The submitted password and invite code never appear in application logs.
- R11. The signup and login forms are reachable from each other via the existing segmented toggle, and both render in English and Chinese.

---

## Key Flows

- F1. Successful signup
  - **Trigger:** Visitor selects Sign up, fills the form with a valid invite code and an unused email.
  - **Steps:** Input is validated client-side, then server-side; the invite code is checked; the password is hashed; the user row is created with the `LANDLORD` role; a session is opened and set as a cookie; the client lands on the app root already authenticated.
  - **Covers:** R1, R4, R5, R8.
- F2. Rejected signup
  - **Trigger:** Visitor submits a wrong invite code, an already-registered email, or a short password.
  - **Steps:** No user row is created; the form surfaces a message specific enough to act on for the email and password cases, and deliberately generic for the invite code.
  - **Covers:** R2, R5, R7.
- F3. Signup disabled
  - **Trigger:** Any signup request while no invite code is configured.
  - **Steps:** The request is refused before any user lookup or creation.
  - **Covers:** R3.
- F4. Case-insensitive login after signup
  - **Trigger:** A user who registered with mixed-case email logs in later using different casing.
  - **Steps:** The address normalizes to the same stored value and the session is issued.
  - **Covers:** R6.

---

## Acceptance Examples

- AE1. **Covers R1, R8.** Given a configured invite code, when a visitor signs up with it and an unused email, then they are logged in, land in the app, and their invoice, property, and contractor lists are empty regardless of what other landlords have.
- AE2. **Covers R2.** Given a configured invite code, when a visitor submits a different code, then no account is created and the response does not distinguish a wrong code from a malformed one.
- AE3. **Covers R3.** Given no invite code is configured, when a signup request arrives with any body, then it is refused and no user row is created.
- AE4. **Covers R6.** Given an account created with `Foo@Bar.com`, when the user logs in with `foo@bar.com`, then the login succeeds.
- AE5. **Covers R6.** Given the seeded landlord created before this change, when they log in with their existing credentials, then the login still succeeds.
- AE6. **Covers R7.** Given an email already registered, when a visitor signs up with that email and a valid code, then the request fails and the existing account's password and session remain unchanged.
- AE7. **Covers R5.** Given a valid invite code, when a visitor submits a 7-character password, then the account is not created and the form reports the length requirement.
- AE8. **Covers R9.** Given repeated signup attempts from one client, when the hourly threshold is exceeded, then further attempts are rejected without reaching account creation.
- AE9. **Covers R10.** Given a signup request at any log level, when logs are inspected, then neither the password nor the invite code appears in them.
- AE10. **Covers R4.** Given a completed signup, when the new user exports an invoice PDF without visiting Settings, then their name renders in the Bill-To section.

---

## Scope Boundaries

Deferred for later:

- **Google OAuth** — the button stays rendered and disabled, as designed.
- **Password reset / forgot password** — the natural follow-up, and the mitigation for this version's mistyped-email risk.
- **Email verification** — revisit if signup ever opens beyond personally-known invitees.
- **Per-invite codes with revocation and audit** — the `InviteCode` table design, if the shared code becomes limiting.
- **Landlord-generated invite links** — the pattern the existing tokenized contractor links already establish.
- **Contractor logins** — contractors remain no-login tokenized submitters; unchanged by this work.
- **Onboarding / empty-state tour for a brand-new tenant** — the existing empty states carry it for now.

---

## Dependencies / Assumptions

- No schema change and no migration: `User.role` already defaults to `LANDLORD` and every tenant-scoped model already keys off `userId` (verified this session).
- `hashPassword()` (argon2id) and `createSession()` are reused as-is; signup introduces no new crypto or session semantics beyond DEC-018.
- Request bodies are not logged — the pino `req` serializer emits only method, url, host, and remoteAddress — so R10 holds without a `redact.paths` change. This is asserted by test rather than assumed to stay true.
- `P2002` already maps to a 409 in the central error handler, so duplicate-email handling needs no new error plumbing.
- Any deployed environment whose `LANDLORD_EMAIL` contains uppercase must have it lowercased when this ships; AE5 is the gate that catches the omission.
- Both locale bundles (`en`, `zh`) must gain the new keys; `login.signUpSoon` is retired.

---

## Outstanding Questions

Deferred to planning:

- Whether the invite code is submitted as a form field or accepted from a URL query parameter that prefills it — the latter makes the code shareable as a link but puts it in browser history and referrers.
- Whether the rate limiter keys on IP alone or on IP plus submitted email.
- Exact component boundary between the card shell and the two form components.

---

## Sources / Research

- `docs/DECISIONS.md` DEC-018 — the auth design this supersedes on the signup question; its session, hashing, and cookie decisions carry forward unchanged. A new DEC entry should record this reversal.
- `docs/plans/2026-06-22-001-feat-auth-crud-ui-phase-3-plan.md` — D-1 deferred public signup and specified the disabled "Soon" affordances this feature activates.
- `docs/design/rent-ops-reference.md` — the auth card design, including the segmented toggle and the Google button that stays disabled.
- `apps/api/src/auth/routes.ts`, `auth/password.ts`, `auth/session.ts` — the login path this endpoint mirrors.
- `apps/api/src/integrations/email.ts` — existing Resend `sendEmail()` helper; unused by v1, but it is why verification and password reset are cheap follow-ups.
- `docs/CONVENTIONS.md` CONV-003, CONV-014, CONV-017 — page/route/form and security-hardening conventions this feature follows.
