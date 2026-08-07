---
date: 2026-08-07
topic: password-field-hardening
---

# Password Field Hardening — Requirements

## Summary

Stop browsers and password managers from filling saved credentials into two places they do not belong — the signup form and the Settings "Current password" field — and require the password to be typed twice when creating an account. Three small changes: `autocomplete` attributes on four password inputs, a confirm-password field on signup backed by a client-only schema, and tests that pin the attributes so a later refactor cannot silently drop them.

---

## Problem Frame

None of this app's password inputs carry an `autocomplete` attribute. `apps/web/src/components/auth/SignupForm.tsx`, `apps/web/src/components/auth/LoginForm.tsx`, and the Settings `SecuritySection` (`apps/web/src/pages/Settings.tsx:74-101`, fields `#current` and `#next`) all render bare `<input type="password">`. With no signal, browsers apply their default heuristics and offer the saved credential for the site — which is right on the login form and wrong on the other two.

On signup that means a returning user is offered their existing account's password while creating a *new* account. On the Settings security form it means "Current password" arrives pre-populated, so the re-authentication step that gates a password change is satisfied by the browser rather than by the person at the keyboard. That weakens the check to roughly nothing: anyone at an unlocked, logged-in session can change the password without knowing it.

Signup also accepts a password typed once. Combined with this app having **no password reset and no email verification** (DEC-029(c)), a typo in that single field produces an account nobody can get into and nobody can recover — the mistyped-email risk DEC-029 already accepts, with a second way in.

The obvious fix does not work: `autocomplete="off"` is deliberately ignored by every major browser on password fields, because sites abused it to break password managers. The attribute browsers do honor is `autocomplete="new-password"`.

---

## Key Decisions

- **`autocomplete="new-password"` is the mechanism**, on both signup password fields and **both** Settings security fields. Rejected: `autocomplete="off"` (ignored by browsers on password inputs) and the readonly-until-focus hack (fights the browser, breaks keyboard and screen-reader flows).
- **"Current password" gets `new-password` too, despite reading oddly.** `autocomplete="current-password"` is precisely the value that invites the prefill this work exists to stop. Semantic tidiness loses to the actual requirement; a comment at the site records why so it is not "corrected" later.
- **The login form is deliberately untouched.** Offering a saved credential there is the correct behavior and a convenience; suppressing it would be user-hostile.
- **Signup's email field allows address-book autofill** (`autocomplete="email"`). That is a contact detail, not a credential — the stated goal is that no saved *credential* is offered. Rejected: suppressing every field, which fights the browser for no security gain and removes a real convenience.
- **The server contract is unchanged.** `SignupSchema` — what `POST /api/auth/signup` parses — does not gain `confirmPassword`. A separate `SignupFormSchema` extends it with the confirm field and the equality check, and only the web form uses it. Rejected: adding the field to `SignupSchema`, which would force every API caller to send a value the server ignores.
- **The mismatch error is pathed to `confirmPassword`**, so it renders under the field the user must fix rather than at the form level.
- **The mismatch message is English in both locales.** Every Zod validation message in this app already renders English regardless of UI language — the forms print `errors.<field>.message` straight through. Making validation messages translatable is genuinely separate work and is not smuggled in here.
- **Autocomplete attributes are asserted in tests.** They are invisible in normal use and produce no error when missing, so nothing else would catch their removal.
- **This reverses an earlier decision.** The signup brainstorm explicitly chose *not* to have a confirm-password field, and spec R4 of `2026-08-07-invite-gated-signup-requirements.md` lists the fields without it. DEC-029 is amended rather than left contradicting the code.

---

## Requirements

- R1. Creating an account never offers or inserts a saved credential into either signup password field.
- R2. The Settings "Current password" field is never pre-populated; the person changing the password must type it.
- R3. Signup requires the password to be entered twice, and will not submit while the two differ.
- R4. When the two differ, the error appears next to the confirmation field.
- R5. The signup API contract is unchanged — it neither requires nor depends on a confirmation value.
- R6. Logging in continues to offer saved credentials as it does today.
- R7. Signup's non-credential fields (email, names) keep ordinary browser autofill.
- R8. The autofill behavior is covered by tests, so removing an attribute fails the suite rather than silently regressing.

---

## Key Flows

- F1. Creating an account
  - **Trigger:** A visitor opens the signup form with a saved credential for this site.
  - **Steps:** Both password fields start empty and no saved credential is offered; the visitor types the password twice; matching values submit, differing values block with the error on the confirmation field.
  - **Covers:** R1, R3, R4.
- F2. Changing a password
  - **Trigger:** A logged-in landlord opens Settings → Security.
  - **Steps:** "Current password" is empty and stays empty until typed; the change proceeds only once it is entered correctly.
  - **Covers:** R2.
- F3. Logging in
  - **Trigger:** A returning user opens the login form.
  - **Steps:** The browser offers the saved credential exactly as it does today.
  - **Covers:** R6.

---

## Acceptance Examples

- AE1. **Covers R1.** Given a saved credential for this site, when the signup form opens, both password fields are empty and no credential is offered for them.
- AE2. **Covers R2.** Given a saved credential and a logged-in session, when Settings → Security opens, "Current password" is empty.
- AE3. **Covers R3, R4.** Given a filled signup form whose two password entries differ, when it is submitted, no account is created and the message appears next to the confirmation field.
- AE4. **Covers R3.** Given a filled signup form whose two password entries match, when it is submitted, the account is created.
- AE5. **Covers R5.** Given a signup request that carries no confirmation value at all, when it reaches the API, it succeeds — the contract is unchanged.
- AE6. **Covers R6.** Given a saved credential, when the login form opens, the browser offers it as before.
- AE7. **Covers R8.** Given any password input in signup or Settings Security, when its autofill attribute is removed, the test suite fails.

---

## Scope Boundaries

Deferred or excluded:

- **Password reset and email verification** — still absent, still the accepted risk from DEC-029(c). Confirming the password narrows one way to lock yourself out; it does not remove the underlying gap.
- **A confirm field on the Settings "New password"** — not requested; the current password already gates that form and the user is authenticated.
- **Password strength meters or composition rules** — the 8-character floor stands (DEC-029, spec R5 of the signup work).
- **Translating validation messages** — a real piece of work affecting every form in the app, not this one.
- **Changing login's autofill** — deliberately unchanged.
- **Suppressing address-book autofill** on email or names.

---

## Dependencies / Assumptions

- `autocomplete="new-password"` is honored by the browsers this app targets; `autocomplete="off"` is not, on password inputs. This is the entire technical basis of R1 and R2.
- The Settings security form is `SecuritySection` in `apps/web/src/pages/Settings.tsx:74-101`, with inputs `#current` and `#next` held in local `useState` — no schema or API change is needed for R2, only attributes (verified).
- `ChangePasswordSchema` (`packages/shared/src/schemas/settings.ts:28-30`) and the change-password endpoint are unchanged by this work.
- Zod object schemas strip unknown keys by default, so a stray `confirmPassword` reaching the API would be ignored — but the form omits it anyway rather than relying on that.
- Attribute-level assertions are the only practical test: real browser autofill cannot be exercised in jsdom, so the tests verify the signal the app sends, not the browser's response to it. That limitation is why AE1/AE2 are also worth one manual check.

---

## Outstanding Questions

Deferred to planning:

- Whether `SignupFormSchema` lives beside `SignupSchema` in `packages/shared/src/schemas/auth.ts` or in the web app, given it is the only client-only schema in a package otherwise shared by both apps.
- Whether the confirm field sits directly beneath the password field or after it in the form's existing two-column name row layout.

---

## Sources / Research

- `apps/web/src/components/auth/SignupForm.tsx`, `apps/web/src/components/auth/LoginForm.tsx`, `apps/web/src/pages/Settings.tsx:74-101` — the three sites, none of which currently carry an `autocomplete` attribute (verified).
- `packages/shared/src/schemas/auth.ts` — `SignupSchema` (the API contract) and `LoginSchema`.
- `docs/DECISIONS.md` DEC-029 — the signup decisions this amends: (c) records the no-reset/no-verification posture that makes a typo unrecoverable, and the field list that gains a confirmation input.
- `docs/brainstorms/2026-08-07-invite-gated-signup-requirements.md` R4 — the field list this supersedes.
