---
date: 2026-08-10
topic: password-reset
---

# Operator-Issued Password Reset — Requirements

## Summary

Give a locked-out landlord a way back into their account that does not require
editing the database by hand. The operator runs a local script, which prints a
single-use link valid for an hour; the landlord opens it and sets a new
password. No email is sent and no table is added — the token is derived, and its
single-use property falls out of including the password hash in the signature.
Closes the recovery half of DEC-029(c).

---

## Problem Frame

There is no password reset. DEC-029(c) accepted that when the app had one user
and signup did not exist. Signup is now live in production behind a shared
invite code, so a second landlord can exist, and the only recovery path for a
forgotten password is the operator editing `users.passwordHash` directly — which
means hashing a password by hand and writing it to the production database.

**Email is not an option here.** `apps/api/src/integrations/email.ts` exists and
`sendEmail()` is used by the vendor digest, but `RESEND_API_KEY` has never been
set in Vercel (verified 2026-08-10: production carries `EMAIL_FROM` and nine
other variables, not the key). `loadConfig()` throws `EMAIL_NOT_CONFIGURED`, and
the digest's `catch { failed++ }` swallows it without a log line — so production
email has never delivered and nothing says so. Beyond that, reaching any
recipient other than the Resend account owner requires verifying a sending
domain, and the user has declined to register one for this purpose. A reset flow
built on email would deploy inert while looking functional, which is worse than
not shipping it.

**There is also no administrator.** `Role` is `LANDLORD | VENDOR`, and every
`User` is a landlord tenant scoped to its own data. Any in-app screen that
issued reset links for *other* accounts would hand every invited landlord the
ability to take over every other landlord's account — a privilege-escalation
hole considerably worse than the lockout it fixes. The issuing power therefore
has to live outside the app's authorization model entirely.

---

## Key Decisions

- **A local script issues the link; there is no in-app issuing surface.**
  Whoever can run it can already edit the database directly, so it grants no new
  authority and adds no endpoint whose purpose is minting account-takeover
  links. Rejected: an admin-gated Settings screen, which would require inventing
  an `ADMIN` role (or pinning on `LANDLORD_USER_ID`), plus an authenticated
  endpoint and its own authorization tests, to buy the ability to issue a link
  from a phone. Revisit only if being away from a laptop actually becomes the
  blocker.
- **No email, by design** — not deferred pending configuration. The flow is
  complete without it. See Problem Frame.
- **The token is derived, not stored**: `HMAC-SHA256(RESET_LINK_KEY,
  "userId:expiresAt:passwordHash")`. No table, no migration, no expiry-sweep
  job. Rejected: a `PasswordResetToken` model, which buys nothing the derivation
  does not already give and adds a row to garbage-collect.
- **The current password hash is a signature input, which makes the link
  single-use for free.** Consuming it writes a new hash, so the old signature
  stops verifying. This also means issuing a second link retires the first,
  which is the desired behavior. Rejected: a `usedAt` column.
- **This mirrors the vendor-link idiom (DEC-034)**, where `tokenVersion` plays
  the role the password hash plays here — one derived-token pattern in the
  codebase, not two.
- **A separate `RESET_LINK_KEY`, not `VENDOR_LINK_KEY`.** Distinct purposes must
  not share a key; one leak would otherwise compromise both.
- **Every failure returns one identical error.** Bad shape, unknown user,
  tampered signature, expired, already consumed — all the same code, status, and
  message, mirroring `validateLinkToken`'s "null for ANY failure". Anything finer
  turns the endpoint into an account-existence oracle.
- **The token rides in the URL fragment, not a path or query parameter.**
  Fragments are not sent in `Referer` headers and do not appear in server access
  logs. `/submit/:token` uses a path parameter, which is a fair trade for a
  shareable vendor link and the wrong one for a password reset.
- **Consuming the link destroys every session for that user**, unlike the
  Settings password change which deliberately keeps the caller's own session
  alive (KTD-2). There is no session to preserve here, and if an attacker holds
  one, this is precisely when it should die.
- **The password is typed twice**, consistent with DEC-031.

---

## Requirements

- R1. The operator can produce a working reset link for any account from a
  command run locally, without editing the database.
- R2. The link works exactly once.
- R3. The link stops working after one hour.
- R4. A tampered or fabricated link is refused.
- R5. Using the link sets the account's password and signs that account out
  everywhere.
- R6. After using the link, the landlord can log in with the new password.
- R7. No failure of the reset endpoint reveals whether an account exists, nor
  which aspect of the link was wrong.
- R8. Issuing a new link for an account invalidates any previous one.
- R9. The reset page is reachable without logging in.
- R10. The reset form requires the new password twice and will not submit while
  the two differ.
- R11. The token does not appear in server access logs or `Referer` headers —
  neither via the URL (it rides in the fragment, which browsers do not send) nor
  via the request body (the logger's `req` serializer records method, URL, host,
  and remote address only, never a body).
- R12. The script never prints a password hash, the signing key, or any other
  secret.
- R13. The reset endpoint is rate-limited.
- R14. No email is sent, and the flow does not depend on email being configured.

---

## Key Flows

- F1. Recovering an account
  - **Trigger:** A landlord tells the operator they are locked out.
  - **Steps:** The operator runs the script with their email and passes on the
    printed link; the landlord opens it, types a new password twice, and is sent
    to the login page to sign in.
  - **Covers:** R1, R5, R6, R9, R10.
- F2. A link that has already been used
  - **Trigger:** Someone opens a link that was consumed earlier.
  - **Steps:** The reset is refused with the generic error; nothing changes.
  - **Covers:** R2, R7.
- F3. A stale or tampered link
  - **Trigger:** A link older than an hour, or one whose contents were edited.
  - **Steps:** Refused with the same generic error, indistinguishable from any
    other failure.
  - **Covers:** R3, R4, R7.
- F4. Re-issuing
  - **Trigger:** The operator issues a second link before the first is used.
  - **Steps:** The newer link works; the older one is refused.
  - **Covers:** R8.

---

## Acceptance Examples

- AE1. **Covers R1, R5, R6.** Given a link issued for an account, when it is
  used with a new password, then the password changes, every session for that
  account is gone, and the new password logs in.
- AE2. **Covers R2.** Given a link that has been used once, when it is used
  again, then it is refused and the password is unchanged.
- AE3. **Covers R3.** Given a link whose expiry has passed, when it is used,
  then it is refused.
- AE4. **Covers R4.** Given a link with any byte of its signature or payload
  altered, when it is used, then it is refused.
- AE5. **Covers R7.** Given an unknown account, an expired link, a tampered
  link, and a malformed link, when each is submitted, then all four responses
  are byte-identical in status, code, and message.
- AE6. **Covers R8.** Given two links issued in sequence for one account, when
  the older is used, then it is refused; when the newer is used, it succeeds.
- AE7. **Covers R10.** Given the reset form with two differing passwords, when
  it is submitted, then nothing is sent and the mismatch is shown by the
  confirmation field.
- AE8. **Covers R9.** Given no session, when the reset page is opened, then it
  renders rather than redirecting to login.
- AE9. **Covers R12.** Given the script is run, when its output is inspected,
  then it contains no password hash and no signing key.
- AE10. **Covers R13.** Given repeated reset attempts beyond the limit, when the
  next is made, then it is rate-limited.

---

## Scope Boundaries

Deferred or excluded:

- **Self-service reset** — a landlord cannot initiate recovery themselves; they
  must reach the operator. That is the accepted cost of having no deliverable
  email, and it fits DEC-029's "handful of personally-known invitees".
- **An admin role or any in-app issuing screen** — see Key Decisions. Revisit
  only if issuing away from a laptop becomes a real blocker.
- **Email verification at signup**, and therefore **recovery of an account
  created with a mistyped email**. This feature recovers an account by identity,
  not by email, so a wrong address is still fixed by hand. DEC-029(c)'s
  verification half stays open.
- **Fixing production email** (`RESEND_API_KEY` unset, digests silently
  failing). Real and worth doing, but separate — this design deliberately does
  not depend on it.
- **Rate limiting the issuing script** — it runs locally, under the operator.
- **Password strength rules beyond the existing 8-character floor** (DEC-029).

---

## Dependencies / Assumptions

- `WEB_ORIGIN` is already set in Vercel production (verified) and is what the
  script builds the link from.
- `RESET_LINK_KEY` is new and must be provisioned before the endpoint can verify
  anything; unset must fail closed with a named, actionable error rather than a
  generic 500 — the lesson recorded for `VENDOR_LINK_KEY` in DEC-034.
- `hashPassword` / `verifyPassword` (argon2id) and the session table already
  exist; this adds no new crypto primitive beyond an HMAC the codebase already
  uses in `apps/api/src/vendors/token.ts`.
- The 8-character minimum comes from `ChangePasswordSchema`
  (`packages/shared/src/schemas/settings.ts:34`); the reset schema matches it so
  the two paths cannot diverge.
- Public routing already supports an unauthenticated page outside `AuthGuard` —
  `/login` and `/submit/:token` are the precedent (`apps/web/src/main.tsx:33-36`).
- R11 needs no new redaction. The custom `req` serializer
  (`apps/api/src/app.ts:60-67`) logs `method`, `url`, `host`, and
  `remoteAddress` only — never a request body — so a token posted in a body does
  not reach the logs, and the fragment keeps it out of the URL that *is* logged
  (verified). This is why the vendor links needed `redactUrlToken` and this does
  not: their secret is in the path.
- Including the password hash in the signature assumes a reset always changes the
  hash. Argon2id salts per call, so re-using the same password still produces a
  different hash and still invalidates the link.

---

## Outstanding Questions

Deferred to planning:

- Whether the token helpers live in a new `apps/api/src/auth/resetToken.ts` or
  alongside the session helpers in `apps/api/src/auth/session.ts`.
- Whether the script lives in `apps/api/prisma/` beside the other one-off `tsx`
  scripts, or in a new `apps/api/scripts/` directory.

---

## Sources / Research

- `docs/DECISIONS.md` DEC-029(c) — the accepted no-reset posture this closes
  half of; DEC-031 — the confirm-password decision the form follows; DEC-034 —
  the derived-token idiom this mirrors, and its unset-key lesson.
- `apps/api/src/vendors/token.ts:30-78` — `linkKey()`, `deriveSecret`, and the
  "null for ANY failure" resolution this copies.
- `apps/api/src/integrations/email.ts:14-21` — `loadConfig()`, which throws when
  `RESEND_API_KEY` is unset; `apps/api/src/notifications/digest.ts:83-87` — the
  `catch { failed++ }` that hides it.
- `apps/api/src/settings/handlers.ts` `changePassword` — the session-invalidation
  pattern, which this deliberately diverges from by killing all sessions.
- `apps/web/src/main.tsx:33-36` — the public-route precedent.
- `packages/shared/src/schemas/settings.ts:31-35` — `ChangePasswordSchema` and
  its 8-character floor.
