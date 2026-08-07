import { z } from 'zod'
import { InvoiceImageInputSchema, InvoiceStatus, MAX_INVOICE_IMAGES } from './invoice'

const DAY_MS = 86_400_000

// What a vendor submits via their link (no login). No category — the
// landlord sets it on review; the vendor defaults to the vendor's name
// server-side. At least one photo is REQUIRED (it is the proof), up to the cap.
// Date bounds are tighter than the landlord path: not in the future (1-day
// timezone slack), not older than ~12 months — a vendor fat-fingering 2099
// or 1999 is rejected.
export const SubmissionSchema = z.object({
  amount: z.number().positive().multipleOf(0.01).lte(99_999_999.99),
  description: z.string().trim().min(1).max(500),
  invoiceDate: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + DAY_MS, 'Invoice date cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 366 * DAY_MS, 'Invoice date is too far in the past'),
  images: z.array(InvoiceImageInputSchema).min(1).max(MAX_INVOICE_IMAGES),
})
export type SubmissionInput = z.infer<typeof SubmissionSchema>

// What a vendor may change while a submission is still SUBMITTED (amount,
// description, date — same validators as submit, all optional). The photo is not
// edited here in v1.
export const EditSubmissionSchema = z.object({
  amount: SubmissionSchema.shape.amount.optional(),
  description: SubmissionSchema.shape.description.optional(),
  invoiceDate: SubmissionSchema.shape.invoiceDate.optional(),
})
export type EditSubmissionInput = z.infer<typeof EditSubmissionSchema>

/** A vendor's own submission as shown in their status list (safe fields only). */
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

// A lightweight vendor the landlord collects invoices from via a no-login
// link. NOT a User — no password, no session. The link token is a bearer
// credential; the API never returns the token secret/hash, only whether the
// link is active. The full plaintext link is surfaced exactly once, in the
// create/regenerate response (see VendorWithLinkSchema).

// Phone and email are both optional columns, but at least one must be present
// on a landlord-entered vendor. The DB keeps both nullable because the invoice
// auto-create path deliberately writes a name-only vendor (see the plan's Task 5).
export const CreateVendorSchema = z
  .object({
    // Bounded to Invoice.vendorName (max 100) — the name is defaulted into a
    // submission's vendorName, so an over-long name would otherwise fail submit.
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(50).optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
  })
  .refine((v) => v.phone != null || v.email != null, {
    message: 'Provide a phone number or an email address',
    path: ['phone'],
  })

export const UpdateVendorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
})

/** The vendor as the landlord lists/views them — never the token secret. */
export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkActive: z.boolean(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

/** create/regenerate responses carry the one-time plaintext link. */
export const VendorWithLinkSchema = VendorSchema.extend({ link: z.string() })

export type CreateVendorInput = z.infer<typeof CreateVendorSchema>
export type UpdateVendorInput = z.infer<typeof UpdateVendorSchema>
export type Vendor = z.infer<typeof VendorSchema>
export type VendorWithLink = z.infer<typeof VendorWithLinkSchema>
