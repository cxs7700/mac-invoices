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
  // 50, not 100: must match UpdateProfileSchema's firstName/lastName bound
  // (packages/shared/src/schemas/settings.ts) — Settings always sends
  // firstName on save, so a longer signup value would 400 on every future
  // profile save, including one that only touches email.
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
})

export type SignupInput = z.infer<typeof SignupSchema>

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
  // No `.min(1)`: zodResolver defaults to criteriaMode 'firstError', so if this
  // field had its own length issue it would win over the mismatch message
  // below whenever both fire (e.g. an empty confirmation) — surfacing a raw
  // Zod internal string like "Too small: expected string to have >=1
  // characters" instead of "Passwords do not match". An empty string can
  // never equal a >=8-character password, so the refinement alone still
  // catches it, with the message users should actually see.
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: 'Passwords do not match',
  // Path the issue at the confirmation field so it renders beneath the input
  // the user has to change, not at the top of the form.
  path: ['confirmPassword'],
})

export type SignupFormInput = z.infer<typeof SignupFormSchema>

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
