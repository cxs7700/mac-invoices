import { z } from 'zod'

// Landlord self-serve settings. Profile v1 edits the display name only — email
// is the unique login id with no verification flow, so it is read-only.
export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

// The account shape the settings UI reads (never the password hash).
export const AccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
})
export type Account = z.infer<typeof AccountSchema>
