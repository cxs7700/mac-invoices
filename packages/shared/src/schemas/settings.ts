import { z } from 'zod'

// Landlord self-serve settings. Profile v1 edits the display name only — email
// is the unique login id with no verification flow, so it is read-only.
export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
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

// The account shape the settings UI reads (never the password hash).
export const AccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
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
