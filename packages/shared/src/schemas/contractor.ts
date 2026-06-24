import { z } from 'zod'

// A lightweight contractor the landlord collects invoices from via a no-login
// link. NOT a User — no password, no session. The link token is a bearer
// credential; the API never returns the token secret/hash, only whether the
// link is active. The full plaintext link is surfaced exactly once, in the
// create/regenerate response (see ContractorWithLinkSchema).

export const CreateContractorSchema = z.object({
  // Bounded to Invoice.vendorName (max 100) — the name is defaulted into a
  // submission's vendorName, so an over-long name would otherwise fail submit.
  name: z.string().trim().min(1).max(100),
  // Free-text, display-only in v1 (no SMS/email). Phone or email, the landlord's call.
  contact: z.string().trim().min(1).max(200),
})
export const UpdateContractorSchema = CreateContractorSchema.partial()

/** The contractor as the landlord lists/views them — never the token secret. */
export const ContractorSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  linkActive: z.boolean(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

/** create/regenerate responses carry the one-time plaintext link. */
export const ContractorWithLinkSchema = ContractorSchema.extend({ link: z.string() })

export type CreateContractorInput = z.infer<typeof CreateContractorSchema>
export type UpdateContractorInput = z.infer<typeof UpdateContractorSchema>
export type Contractor = z.infer<typeof ContractorSchema>
export type ContractorWithLink = z.infer<typeof ContractorWithLinkSchema>
