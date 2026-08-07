# Password Field Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop saved credentials from filling the signup form and the Settings "Current password" field, and require the signup password to be typed twice.

**Architecture:** `autocomplete="new-password"` on four password inputs (the only value browsers honor for this — `off` is deliberately ignored on password fields). A client-only `SignupFormSchema` extends the server's `SignupSchema` with a `confirmPassword` field and an equality check, so the API contract is unchanged; the form strips the confirmation before POSTing.

**Tech Stack:** React 19, React Hook Form, Zod 4 (`@mac-invoices/shared`), react-i18next, Vitest + Testing Library.

**Spec:** `docs/brainstorms/2026-08-07-password-field-hardening-requirements.md`

## Global Constraints

- **`autocomplete="new-password"`, never `autocomplete="off"`.** Browsers deliberately ignore `off` on password inputs. This applies to **both** Settings security fields, including "Current password" — `current-password` there is exactly the value that causes the prefill this work removes.
- **Do not touch `apps/web/src/components/auth/LoginForm.tsx`.** Offering a saved credential on login is correct and deliberate.
- **The server contract does not change.** `SignupSchema` must not gain `confirmPassword`; `POST /api/auth/signup` must keep working for a caller that sends only the five original fields.
- **`apps/web/src/pages/Settings.tsx` is not internationalized** — its labels are hardcoded English strings. Do not add i18n there; match the surrounding style.
- **Validation messages are English in both locales.** Every Zod message in this app renders English regardless of UI language (forms print `errors.<field>.message` verbatim). Do not build a translation mechanism for the mismatch message.
- **Password floor stays 8 characters, no composition rules** (DEC-029). Do not add strength meters or character-class rules.
- **Test commands** (no database needed for any task in this plan):
  ```bash
  npm test -w @mac-invoices/shared
  npm test -w @mac-invoices/web
  npm run lint && npm run typecheck
  ```
  ⚠️ Do **not** run `npm run test` from the repo root and do **not** run the api suite — the root `.env` `DATABASE_URL` points at a **hosted production database**. Nothing in this plan needs it.

---

### Task 1: `SignupFormSchema` in shared

**Files:**
- Modify: `packages/shared/src/schemas/auth.ts`
- Test: `packages/shared/test/auth.test.ts`

**Interfaces:**
- Consumes: the existing `SignupSchema` (fields `inviteCode`, `email`, `password`, `firstName`, `lastName`).
- Produces:
  - `SignupFormSchema` — `SignupSchema` plus `confirmPassword: string`, refined so `password === confirmPassword`, with the error pathed to `confirmPassword`.
  - `type SignupFormInput = z.infer<typeof SignupFormSchema>`.
  - `SignupSchema` and `SignupInput` are unchanged. Task 2 uses `SignupFormSchema` in the form and strips `confirmPassword` before calling the API.

**Decision resolved from the spec's Outstanding Questions:** the schema lives in `packages/shared/src/schemas/auth.ts` beside `SignupSchema`, not in the web app. Extending in place keeps the two in lockstep — a field later added to `SignupSchema` is inherited automatically — whereas a copy in the web app would silently drift. The doc comment states that it is client-only.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/test/auth.test.ts` (leave the existing describes untouched). Note the import line at the top of the file must also gain `SignupFormSchema`:

```ts
describe('SignupFormSchema', () => {
  const valid = {
    inviteCode: 'code',
    email: 'new@example.com',
    password: 'longenough',
    confirmPassword: 'longenough',
    firstName: 'Ada',
    lastName: 'Lovelace',
  }

  it('accepts a payload whose passwords match', () => {
    expect(SignupFormSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a payload whose passwords differ', () => {
    expect(SignupFormSchema.safeParse({ ...valid, confirmPassword: 'different' }).success).toBe(
      false,
    )
  })

  it('paths the mismatch error to confirmPassword so it renders under that field', () => {
    const result = SignupFormSchema.safeParse({ ...valid, confirmPassword: 'different' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((i) => i.path.join('.') === 'confirmPassword')).toBe(true)
  })

  it('rejects an empty confirmation', () => {
    expect(SignupFormSchema.safeParse({ ...valid, confirmPassword: '' }).success).toBe(false)
  })

  it("inherits SignupSchema's rules — a short password still fails even when confirmed", () => {
    expect(
      SignupFormSchema.safeParse({ ...valid, password: '1234567', confirmPassword: '1234567' })
        .success,
    ).toBe(false)
  })

  it("inherits SignupSchema's email normalization", () => {
    const parsed = SignupFormSchema.parse({ ...valid, email: ' New@Example.COM ' })
    expect(parsed.email).toBe('new@example.com')
  })

  it('leaves the server contract alone — SignupSchema still has no confirmPassword', () => {
    const parsed = SignupSchema.parse({
      inviteCode: 'code',
      email: 'new@example.com',
      password: 'longenough',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    expect('confirmPassword' in parsed).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @mac-invoices/shared`
Expected: FAIL — `SignupFormSchema` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/shared/src/schemas/auth.ts`, after `SignupSchema` and `SignupInput`:

```ts
/**
 * Signup as the WEB FORM validates it: `SignupSchema` plus a confirmation the
 * user must retype, so a typo cannot silently create an account nobody can log
 * into (there is no password reset — DEC-029(c)).
 *
 * CLIENT-ONLY. `POST /api/auth/signup` parses `SignupSchema`, so the server
 * never requires a redundant confirmation value and existing API callers keep
 * working. Extending rather than redeclaring keeps the two in lockstep: a field
 * added to `SignupSchema` is inherited here automatically.
 *
 * The message is English in both locales, consistent with every other Zod
 * message in this app (forms render `errors.<field>.message` verbatim).
 */
export const SignupFormSchema = SignupSchema.extend({
  confirmPassword: z.string().min(1),
}).refine((v) => v.password === v.confirmPassword, {
  message: 'Passwords do not match',
  // Path the issue at the confirmation field so it renders beneath the input
  // the user has to change, not at the top of the form.
  path: ['confirmPassword'],
})

export type SignupFormInput = z.infer<typeof SignupFormSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @mac-invoices/shared`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Verify nothing else broke**

Run: `npm run lint && npm run typecheck`
Expected: clean. `packages/shared/src/index.ts` already does `export * from './schemas/auth'`, so no index change is needed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/auth.ts packages/shared/test/auth.test.ts
git commit -m "feat(shared): client-only SignupFormSchema with confirmPassword

Extends SignupSchema rather than redeclaring it, so the two cannot drift.
The server contract is untouched -- POST /api/auth/signup still parses
SignupSchema and never requires a confirmation value."
```

---

### Task 2: Confirm-password field on the signup form

**Files:**
- Modify: `apps/web/src/components/auth/SignupForm.tsx`
- Modify: `apps/web/src/locales/en/translation.json`, `apps/web/src/locales/zh/translation.json`
- Test: `apps/web/test/Signup.test.tsx`

**Interfaces:**
- Consumes: `SignupFormSchema` / `SignupFormInput` from Task 1.
- Produces: a signup form that validates with `SignupFormSchema` and calls `signup.mutate()` with **only** the five `SignupInput` fields — `confirmPassword` is stripped before the request.

**Note on existing tests:** three tests in `Signup.test.tsx` currently fill five fields and expect a successful submit. Adding a required confirmation makes them fail. Updating them to fill the new field is part of this task and is expected — not a sign something is wrong. The payload assertion in "submits the full signup payload" must stay a five-field object, which is what proves the stripping works.

- [ ] **Step 1: Add the translation keys**

In `apps/web/src/locales/en/translation.json`, inside the `login` block, add after `"password"`:

```json
    "confirmPassword": "Confirm password",
```

In `apps/web/src/locales/zh/translation.json`, in the same position inside its `login` block:

```json
    "confirmPassword": "确认密码",
```

Both files must end up with the same key set.

- [ ] **Step 2: Write the failing tests**

In `apps/web/test/Signup.test.tsx`, first update the three existing tests that submit successfully — "submits the full signup payload", "normalizes a mixed-case email before submitting…", and "blocks submission and reports a too-short password" — by adding this line after each one's `Password` input line:

```ts
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-good-password' } })
```

For the too-short-password test, use `'short'` as the confirmation value so the two still match and the *length* rule is what fails, not the mismatch rule.

Then append these new tests inside the existing `describe('auth card toggle', ...)`:

```ts
  it('renders a confirmation field on the signup form', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))
    expect(screen.getByLabelText('Confirm password')).toBeTruthy()
  })

  it('blocks submission when the two passwords differ', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-different-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeTruthy())
    expect(signupMutate).not.toHaveBeenCalled()
  })

  it('does not send confirmPassword to the API', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    fireEvent.input(screen.getByLabelText('Invite code'), { target: { value: 'the-code' } })
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'a-good-password' } })
    fireEvent.input(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
    fireEvent.input(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(signupMutate).toHaveBeenCalled())
    // The confirmation is a client-side concern; the server contract never sees it.
    expect(signupMutate.mock.calls[0][0]).not.toHaveProperty('confirmPassword')
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @mac-invoices/web -- Signup`
Expected: FAIL — there is no "Confirm password" field, so `getByLabelText` throws in the new tests and the three updated tests fail on the same missing element.

- [ ] **Step 4: Switch the form to `SignupFormSchema`**

In `apps/web/src/components/auth/SignupForm.tsx`, change the import on line 5 and the `useForm` call:

```ts
import { SignupFormSchema, type SignupFormInput } from '@mac-invoices/shared'
```

```ts
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<SignupFormInput>({
    resolver: zodResolver(SignupFormSchema) as Resolver<SignupFormInput>,
  })
```

- [ ] **Step 5: Strip the confirmation before submitting, and focus it on error**

Replace the `onSubmit` block:

```ts
  const onSubmit = handleSubmit(
    ({ confirmPassword: _confirmPassword, ...payload }) => {
      // `confirmPassword` is a client-side check only — the API parses
      // SignupSchema, which has no such field. Dropping it here keeps the
      // request shape exactly the server's contract.
      signup.mutate(payload, { onSuccess: () => navigate('/', { replace: true }) })
    },
    (errs) => {
      const first = (
        ['inviteCode', 'email', 'password', 'confirmPassword', 'firstName', 'lastName'] as const
      ).find((f) => errs[f])
      if (first) setFocus(first)
    },
  )
```

- [ ] **Step 6: Add the field to the form**

In the same file, immediately after the existing password `<div>` (the one containing `id="signup-password"`) and before the `{serverError && (` block, insert:

```tsx
      <div>
        <label htmlFor="signup-confirm-password" className="block text-sm font-medium mb-1">
          {t('login.confirmPassword')}
        </label>
        <input
          id="signup-confirm-password"
          type="password"
          className={fieldClass}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @mac-invoices/web -- Signup`
Expected: PASS — the three updated tests and the three new ones.

- [ ] **Step 8: Run the whole web suite and the quality gates**

```bash
npm test -w @mac-invoices/web
npm run lint && npm run typecheck
```
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/auth/SignupForm.tsx apps/web/src/locales apps/web/test/Signup.test.tsx
git commit -m "feat(web): require the signup password to be typed twice

There is no password reset and no email verification, so a typo in a
single password field creates an account nobody can get into. The
confirmation is client-side only -- the request body is unchanged."
```

---

### Task 3: Suppress saved-credential autofill

**Files:**
- Modify: `apps/web/src/components/auth/SignupForm.tsx`
- Modify: `apps/web/src/pages/Settings.tsx:82-90`
- Test: `apps/web/test/Signup.test.tsx`, `apps/web/test/Settings.test.tsx`

**Interfaces:**
- Consumes: the confirm-password input from Task 2 (`id="signup-confirm-password"`).
- Produces: no new exports — attribute-only changes.

**Why the tests matter here:** these attributes are invisible in normal use and produce no error when absent, so nothing but an explicit assertion catches their removal. jsdom cannot exercise real browser autofill, so these tests verify the *signal the app sends*, not the browser's response — which is why the spec also calls for one manual check in a real browser.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/Signup.test.tsx`, inside the existing describe:

```ts
  it('tells the browser not to offer saved credentials on the signup password fields', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))

    // autocomplete="off" is ignored by browsers on password inputs; the value
    // that actually suppresses saved-credential fill is "new-password".
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('Confirm password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
  })

  it('still allows ordinary address-book autofill for the signup email', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to sign up' }))
    // An email is a contact detail, not a credential — suppressing it would
    // remove a real convenience for no security gain.
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email')
  })

  it('leaves the login form free to offer saved credentials', () => {
    renderLogin()
    // Login is deliberately untouched: offering the saved credential there is
    // correct. Assert we did not "helpfully" suppress it.
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).not.toBe('new-password')
  })
```

Append to `apps/web/test/Settings.test.tsx`, inside the existing `describe('Settings page', ...)`:

```ts
  it('does not let the browser prefill the current-password field', () => {
    render(<Settings />)
    // "current-password" here would be exactly the value that causes the
    // prefill — with it, the re-auth gating a password change is satisfied by
    // the browser rather than by the person at the keyboard.
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w @mac-invoices/web -- Signup
npm test -w @mac-invoices/web -- Settings
```
Expected: FAIL — every `getAttribute('autocomplete')` returns `null`, since no input in either file carries the attribute today. The "leaves the login form free" test should PASS already; it is a guard, not a change.

- [ ] **Step 3: Add the attributes to the signup form**

In `apps/web/src/components/auth/SignupForm.tsx`:

The email input becomes:

```tsx
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          className={fieldClass}
          {...register('email')}
        />
```

The password input becomes:

```tsx
        <input
          id="signup-password"
          type="password"
          // "new-password", not "off": browsers deliberately ignore `off` on
          // password inputs. This is what stops a saved credential being
          // offered while the user is creating a different account.
          autoComplete="new-password"
          className={fieldClass}
          {...register('password')}
        />
```

The confirmation input becomes:

```tsx
        <input
          id="signup-confirm-password"
          type="password"
          autoComplete="new-password"
          className={fieldClass}
          {...register('confirmPassword')}
        />
```

- [ ] **Step 4: Add the attributes to the Settings security form**

In `apps/web/src/pages/Settings.tsx`, replace the two inputs inside `SecuritySection` (currently lines 84 and 88). Keep the surrounding markup and the hardcoded English labels exactly as they are — this file is not internationalized:

```tsx
          {/*
            autoComplete="new-password" on a field labelled "Current password"
            reads oddly on purpose. "current-password" is precisely the value
            that makes browsers prefill it, and a prefilled current-password box
            means the re-authentication gating a password change is satisfied by
            the browser rather than by the person at the keyboard. Do not
            "correct" this to current-password.
          */}
          <input id="current" type="password" autoComplete="new-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
```

```tsx
          <input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -w @mac-invoices/web -- Signup
npm test -w @mac-invoices/web -- Settings
```
Expected: PASS.

- [ ] **Step 6: Run the whole suite and the quality gates**

```bash
npm test -w @mac-invoices/web
npm test -w @mac-invoices/shared
npm run lint && npm run typecheck
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/auth/SignupForm.tsx apps/web/src/pages/Settings.tsx apps/web/test
git commit -m "feat(web): stop saved credentials filling signup and Settings

autocomplete=\"new-password\" on both signup password fields and BOTH
Settings security fields. A prefilled \"Current password\" means the
re-auth gating a password change is satisfied by the browser rather than
by the person, so anyone at an unlocked session could change it.

autocomplete=\"off\" is not an option -- browsers ignore it on password
inputs. Login is deliberately left able to offer saved credentials."
```

---

### Task 4: Decision record

**Files:**
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- Consumes: Tasks 1-3. Produces no code.

- [ ] **Step 1: Record DEC-031**

Append to `docs/DECISIONS.md`, matching the house style of DEC-029/DEC-030 (a bolded title line, then lettered sub-points):

```markdown
## Password field hardening (2026-08-07)

- **DEC-031 — `autocomplete="new-password"` on signup and both Settings security fields; signup requires the password twice** (plan: `docs/plans/2026-08-07-003-feat-password-field-hardening-plan.md`, spec: `docs/brainstorms/2026-08-07-password-field-hardening-requirements.md`). **Amends DEC-029** on the signup field list, which deliberately omitted a confirmation. (a) **`autocomplete="off"` is not usable** — every major browser ignores it on password inputs, because sites abused it to break password managers. `new-password` is the value browsers honor, so it is used on both signup password fields and on **both** Settings security fields. (b) **"Current password" gets `new-password` despite reading oddly.** `current-password` is exactly the value that triggers the prefill this removes, and a prefilled current-password box means the re-authentication gating a password change is satisfied by the browser rather than by the person at the keyboard — anyone at an unlocked, logged-in session could change the password without knowing it. A comment at the site records this so it is not "corrected" later. (c) **Login is deliberately untouched** — offering a saved credential there is correct behavior; a test asserts we did not suppress it. (d) **Signup's email keeps ordinary autofill** (`autocomplete="email"`): a contact detail, not a credential. (e) **The confirmation is client-side only.** `SignupFormSchema` (`packages/shared/src/schemas/auth.ts`) extends `SignupSchema` with `confirmPassword` and an equality refinement pathed to that field; the form strips it before the request, so `POST /api/auth/signup` and every existing API caller are unaffected. Extending rather than redeclaring keeps the two schemas from drifting. Rejected: adding the field to `SignupSchema`, which would force API callers to send a value the server ignores. (f) **The mismatch message is English in both locales**, consistent with every other Zod message in this app — the forms render `errors.<field>.message` verbatim. Translating validation messages is separate work affecting every form. (g) **The attributes are asserted in tests** because they are invisible in normal use and fail silently when removed; jsdom cannot exercise real browser autofill, so the tests verify the signal sent, not the browser's response — one manual check in a real browser with a saved credential is still warranted. (h) **Motivation for (e) beyond typo-catching**: this app still has no password reset and no email verification (DEC-029(c)), so a mistyped password in a single field creates an account nobody can enter and nobody can recover.
```

- [ ] **Step 2: Amend DEC-029's field list so it does not contradict the code**

DEC-029 describes the signup form's fields without a confirmation. Append a pointer to the relevant sub-point so a reader is not misled:

```markdown
 **Amended by DEC-031 (2026-08-07)** — the signup form now also requires a confirmation field; the API contract is unchanged.
```

Do not rewrite the rest of DEC-029.

- [ ] **Step 3: Final verification**

```bash
npm run lint && npm run typecheck
npm test -w @mac-invoices/shared
npm test -w @mac-invoices/web
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs: DEC-031 password field hardening; amends DEC-029

Records why autocomplete=off is unusable, why \"Current password\" gets
new-password despite reading oddly, and why the confirmation is
client-side only."
```

---

## Manual verification (human, after merge)

jsdom cannot exercise real autofill, so one pass in a real browser with a saved credential for the site is worth doing:

1. Open the signup form — both password fields empty, no credential offered.
2. Open Settings → Security — "Current password" empty.
3. Open the login form — the saved credential **is** still offered.

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| R1 no saved credential on signup password fields | 3 |
| R2 Settings "Current password" never prefilled | 3 |
| R3 password typed twice, mismatch blocks submit | 1, 2 |
| R4 mismatch error beside the confirmation field | 1 (`path`), 2 (render) |
| R5 signup API contract unchanged | 1 (client-only schema), 2 (strip before POST) |
| R6 login still offers saved credentials | 3 (guard test; no change made) |
| R7 signup email/names keep ordinary autofill | 3 |
| R8 autofill behavior covered by tests | 3 |
