import { z } from 'zod'
import { EmailSchema } from './auth'

// Supported UI languages (server-validated; mirrored by the web i18n config).
export const Locale = z.enum(['en', 'zh'])
export type Locale = z.infer<typeof Locale>

// Landlord self-serve settings. Profile edits first/last name, email, and/or
// the UI locale — all optional so the language switcher can PATCH just
// `{ locale }`. Email has no confirmation/verification loop (a typo can lock
// the landlord out); the unique constraint on `users.email` still returns 409
// on a collision via the existing central P2002 handling. Email reuses the
// shared `EmailSchema` (trim + lowercase before validation) so a profile edit
// can never write a mixed-case address that login's lowercase `findUnique`
// could then never match — see EmailSchema's doc comment.
export const UpdateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(50).optional(),
  // Unlike firstName, an empty string is valid here — it's the "clear this
  // field" signal (a landlord has no last name to give). `undefined` means
  // "leave unchanged" (the PATCH-just-one-field contract); "" means "set to
  // null". Both are distinct from omitting the key entirely.
  lastName: z.string().trim().max(50).optional(),
  email: EmailSchema.optional(),
  locale: Locale.optional(),
})
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

// Change password: the current password is required (re-auth), the new one must
// clear a real minimum. Login accepts min(1) to attempt any credential, but a
// *new* password deserves a real floor — 8 chars.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>

// The account shape the settings UI reads (never the password hash). `name` is
// kept (derived server-side from firstName+lastName) so the many read paths
// that only need a generic display name (event actors, invoice embeds) are
// unaffected by the profile split.
export const AccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.string(),
  locale: z.string(),
})
export type Account = z.infer<typeof AccountSchema>

// Save a per-landlord Google Sheets target.
export const SaveSheetSchema = z.object({
  spreadsheetId: z.string().trim().min(1).max(200),
})
export type SaveSheetInput = z.infer<typeof SaveSheetSchema>

// The Sheets connection status surfaced in Settings. Never includes the key.
export const SheetsStatusSchema = z.object({
  configured: z.boolean(),
  serviceAccountEmail: z.string().nullable(),
  targetSpreadsheetId: z.string().nullable(),
  reachable: z.boolean(),
})
export type SheetsStatus = z.infer<typeof SheetsStatusSchema>
