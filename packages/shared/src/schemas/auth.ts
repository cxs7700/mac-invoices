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
