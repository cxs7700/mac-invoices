import { z } from 'zod'
import {
  InvoiceCategory,
  InvoiceImageInputSchema,
  InvoiceItemInputSchema,
  InvoiceStatus,
  MAX_INVOICE_IMAGES,
  MAX_INVOICE_ITEMS,
} from './invoice'
import { formatPhone } from '../lib/formatPhone'

const DAY_MS = 86_400_000

// What a vendor submits via their link (no login). No category — the
// landlord sets it on review; the vendor defaults to the vendor's name
// server-side. At least one photo is REQUIRED (it is the proof), up to the cap.
// Date bounds are tighter than the landlord path: not in the future (1-day
// timezone slack), not older than ~12 months — a vendor fat-fingering 2099
// or 1999 is rejected.
export const SubmissionSchema = z.object({
  // Itemized like the landlord form: the vendor lists the work line by line and
  // the total is summed server-side, so the two paths produce the same shape of
  // invoice rather than the vendor's arriving as a single opaque line.
  items: z.array(InvoiceItemInputSchema).min(1).max(MAX_INVOICE_ITEMS),
  invoiceDate: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + DAY_MS, 'Invoice date cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 366 * DAY_MS, 'Invoice date is too far in the past'),
  notes: z.string().trim().max(2000).optional(),
  partsOrdered: z.string().trim().max(500).optional(),
  // Both optional, and both only ever a suggestion: the landlord can change
  // either on review. They exist because approving REQUIRES a category and a
  // property, so a vendor who knows them saves the landlord a round trip.
  // `propertyId` is validated against the LINK'S OWN landlord server-side — a
  // token must never be able to attach another landlord's property.
  category: InvoiceCategory.optional(),
  propertyId: z.string().min(1).optional(),
  // Photos are OPTIONAL as of 2026-08-09, reversing the original "at least one
  // photo is the proof" rule (KTD/AE2): vendors were being blocked at submit
  // when they had a paper invoice they could not photograph on the spot. The
  // landlord still sees a photo-less invoice flagged in review, so the evidence
  // requirement moves from the form to the reviewer's judgement.
  images: z.array(InvoiceImageInputSchema).max(MAX_INVOICE_IMAGES).optional(),
})
export type SubmissionInput = z.infer<typeof SubmissionSchema>

// What a vendor may change while a submission is still SUBMITTED (same
// validators as submit, all optional). The photo is not edited here in v1.
export const EditSubmissionSchema = z.object({
  items: SubmissionSchema.shape.items.optional(),
  invoiceDate: SubmissionSchema.shape.invoiceDate.optional(),
  notes: SubmissionSchema.shape.notes,
  partsOrdered: SubmissionSchema.shape.partsOrdered,
  category: SubmissionSchema.shape.category,
  propertyId: SubmissionSchema.shape.propertyId,
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
// Phone is normalized at the schema boundary rather than only on display, so
// one stored shape reaches every consumer — the list, the PDF, the Sheets
// mirror — instead of each formatting it for itself. Numbers that aren't
// 10-digit North-American are stored as typed (see formatPhone).
const PhoneSchema = z.string().trim().min(1).max(50).transform(formatPhone)

export const CreateVendorSchema = z
  .object({
    // Bounded to Invoice.vendorName (max 100) — the name is defaulted into a
    // submission's vendorName, so an over-long name would otherwise fail submit.
    name: z.string().trim().min(1).max(100),
    phone: PhoneSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
  })
  .refine((v) => v.phone != null || v.email != null, {
    message: 'Provide a phone number or an email address',
    path: ['phone'],
  })

// Every field optional: this is also how a name-only auto-created vendor gets
// its phone/email filled in after the fact. Explicit null clears a field.
export const UpdateVendorSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: PhoneSchema.nullish(),
  email: z.string().trim().toLowerCase().email().max(200).nullish(),
})

/**
 * The vendor as the landlord lists/views them. `link` is the vendor's current
 * submission URL, derived server-side on every read so it can be copied at any
 * time (DEC-034); it is null once the link is revoked.
 */
export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkActive: z.boolean(),
  link: z.string().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})

/**
 * Retained as an alias: every vendor response now carries the link, so there is
 * no separate "with link" shape.
 */
export const VendorWithLinkSchema = VendorSchema

export type CreateVendorInput = z.infer<typeof CreateVendorSchema>
export type UpdateVendorInput = z.infer<typeof UpdateVendorSchema>
export type Vendor = z.infer<typeof VendorSchema>
export type VendorWithLink = z.infer<typeof VendorWithLinkSchema>
