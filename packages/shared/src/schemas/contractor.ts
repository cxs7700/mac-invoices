import { z } from 'zod'
import { InvoiceImageInputSchema, InvoiceStatus } from './invoice'

const DAY_MS = 86_400_000

// What a contractor submits via their link (no login). No category — the
// landlord sets it on review; the vendor defaults to the contractor's name
// server-side. The photo is REQUIRED (it is the proof). Date bounds are tighter
// than the landlord path: not in the future (1-day timezone slack), not older
// than ~12 months — a contractor fat-fingering 2099 or 1999 is rejected.
export const SubmissionSchema = z.object({
  amount: z.number().positive().multipleOf(0.01).lte(99_999_999.99),
  description: z.string().trim().min(1).max(500),
  invoiceDate: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + DAY_MS, 'Invoice date cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 366 * DAY_MS, 'Invoice date is too far in the past'),
  image: InvoiceImageInputSchema,
})
export type SubmissionInput = z.infer<typeof SubmissionSchema>

// What a contractor may change while a submission is still SUBMITTED (amount,
// description, date — same validators as submit, all optional). The photo is not
// edited here in v1.
export const EditSubmissionSchema = z.object({
  amount: SubmissionSchema.shape.amount.optional(),
  description: SubmissionSchema.shape.description.optional(),
  invoiceDate: SubmissionSchema.shape.invoiceDate.optional(),
})
export type EditSubmissionInput = z.infer<typeof EditSubmissionSchema>

/** A contractor's own submission as shown in their status list (safe fields only). */
export const SubmissionStatusSchema = z.object({
  id: z.string(),
  status: InvoiceStatus,
  amount: z.string(),
  description: z.string(),
  invoiceDate: z.coerce.date(),
  rejectionReason: z.string().nullable(),
  createdAt: z.coerce.date(),
})
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>

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
