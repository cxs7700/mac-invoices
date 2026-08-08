import { z } from 'zod'

// SUBMITTED is the entry state for a vendor-submitted invoice, awaiting
// landlord review (approve/reject). Appended (not reordered) so existing
// `.options`-derived UI/zero-fills stay stable.
export const InvoiceStatus = z.enum([
  'PENDING',
  'APPROVED',
  'PAID',
  'REJECTED',
  'CANCELLED',
  'SUBMITTED',
])
export const InvoiceCategory = z.enum([
  'MAINTENANCE',
  'REPAIRS',
  'UTILITIES',
  'SUPPLIES',
  'LABOR',
  'OTHER',
])

// A photo attached to an invoice (the handwritten-invoice proof). `url` is a blob
// the client already uploaded; the server re-validates that it belongs to the
// caller before storing it (KTD-5).
export const ImageType = z.enum(['CASH', 'PARTS', 'CHECK', 'OTHER'])
export const InvoiceImageInputSchema = z.object({
  // A full absolute URL (the stored blob's URL). Requiring a parseable URL — not
  // any string — keeps the owner-prefix gate and what's persisted on one
  // canonical form, so the access check can't diverge from the stored value.
  url: z.string().url(),
  type: ImageType.default('OTHER'),
  caption: z.string().max(200).optional(),
})
export type ImageType = z.infer<typeof ImageType>
export type InvoiceImageInput = z.infer<typeof InvoiceImageInputSchema>

// At most this many photos per invoice (bounds payload + memory). Enforced
// server-side in-transaction (KTD-3) and mirrored by the UI's disable-at-cap.
export const MAX_INVOICE_IMAGES = 5

// Body for appending one photo to an invoice's gallery. Same shape as the
// create/submit image input; aliased so the attach endpoint has a named contract.
export const AttachImageSchema = InvoiceImageInputSchema
export type AttachImageInput = z.infer<typeof AttachImageSchema>

// Body for changing an existing photo's type (landlord gallery, KTD-5).
export const SetImageTypeSchema = z.object({ type: ImageType })
export type SetImageTypeInput = z.infer<typeof SetImageTypeSchema>

// One photo as returned by the API. `url` is a freshly-signed read URL the API
// mints at read time (not the stored blob path); `caption` is unused in v1.
export const InvoiceImageSchema = z.object({
  id: z.string(),
  url: z.string(),
  type: ImageType,
  caption: z.string().nullable(),
  createdAt: z.coerce.date(),
})
export const InvoiceImagesResponseSchema = z.object({ data: z.array(InvoiceImageSchema) })
export type InvoiceImage = z.infer<typeof InvoiceImageSchema>
export type InvoiceImagesResponse = z.infer<typeof InvoiceImagesResponseSchema>

// Body for requesting a direct-upload token (the client uploads browser→storage).
export const ImageUploadTokenSchema = z.object({ contentType: z.string().min(1) })
export type ImageUploadTokenInput = z.infer<typeof ImageUploadTokenSchema>

// One itemized line on an invoice. `total` is entered directly — quantity does
// not multiply a unit price (there is no price field); it is informational,
// matching the "quantity 1" shape every pre-items invoice was backfilled into.
export const InvoiceItemInputSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().int().positive().max(9999),
  // Bounded to the DB column (Decimal(10,2) max 99,999,999.99) so an over-range
  // value returns 400, not a DB overflow -> 500.
  total: z.number().positive().multipleOf(0.01).lte(99_999_999.99),
})
export type InvoiceItemInput = z.infer<typeof InvoiceItemInputSchema>

// An item as returned by the API (persisted row).
export const InvoiceItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number(),
  total: z.string(),
  sortOrder: z.number(),
})
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>

// At most this many line items per invoice (bounds payload + write cost).
export const MAX_INVOICE_ITEMS = 50

export const CreateInvoiceSchema = z.object({
  // Optional: the create form omits it so the server auto-assigns the next
  // sequential number. Still accepted when provided (data import / tests).
  invoiceNumber: z.string().min(1).max(50).optional(),
  vendorName: z.string().min(1).max(100),
  vendorEmail: z.string().email().optional(),
  // The saved vendor this invoice is from. Optional: when omitted and
  // `vendorName` names a vendor the landlord doesn't have yet, the server
  // creates one and links it (see writeService.resolveVendorId).
  vendorId: z.string().optional(),
  // The invoice's total is derived from `items` — the server computes and
  // stores `amount` as their sum; it is never accepted as input.
  items: z.array(InvoiceItemInputSchema).min(1).max(MAX_INVOICE_ITEMS),
  currency: z.string().length(3).default('USD'),
  category: InvoiceCategory,
  propertyId: z.string().optional(),
  invoiceDate: z.coerce.date(),
  notes: z.string().max(1000).optional(),
  partsOrdered: z.string().max(1000).optional(),
  // Optional photos to attach at create time (each uploaded to storage first).
  // 0 is valid (create now, photograph later); capped at MAX_INVOICE_IMAGES.
  // `images[]` is the single source of truth — the legacy `attachmentUrl` column
  // is no longer an input (it is backfilled into image rows and never written).
  images: z.array(InvoiceImageInputSchema).max(MAX_INVOICE_IMAGES).optional(),
})

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().extend({
  status: InvoiceStatus.optional(),
  paidDate: z.coerce.date().optional(),
  // Set by the landlord when rejecting a vendor submission (required on the
  // SUBMITTED → REJECTED transition; surfaced back to the vendor).
  rejectionReason: z.string().min(1).max(500).optional(),
})

// Sort is a whitelist so the API never builds an `orderBy` from a raw string.
export const InvoiceSortField = z.enum(['invoiceDate', 'amount', 'status'])
export const SortOrder = z.enum(['asc', 'desc'])

/**
 * Validates every `GET /api/invoices` query param. Values arrive as strings, so
 * dates/numbers are coerced. `offset` is capped to bound deep-pagination scans.
 */
export const ListInvoicesQuerySchema = z.object({
  status: InvoiceStatus.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  vendor: z.string().trim().min(1).optional(),
  // Free-text search over the job description (case-insensitive contains).
  search: z.string().trim().min(1).optional(),
  // Filter by assigned property: a property id, or the literal "none" for the
  // unassigned (null-property) bucket.
  propertyId: z.string().trim().min(1).optional(),
  sort: InvoiceSortField.default('invoiceDate'),
  order: SortOrder.default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

export type InvoiceStatus = z.infer<typeof InvoiceStatus>
export type InvoiceCategory = z.infer<typeof InvoiceCategory>
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>
export type InvoiceSortField = z.infer<typeof InvoiceSortField>
export type SortOrder = z.infer<typeof SortOrder>
export type ListInvoicesQueryInput = z.infer<typeof ListInvoicesQuerySchema>

// Phase 5 — Google Sheets export. The target sheet is the session user's saved
// `sheetSpreadsheetId` (Settings) only — no server-side fallback; an optional
// spreadsheetId override is accepted (not surfaced in the UI).
export const ExportInvoicesSchema = z.object({
  spreadsheetId: z.string().trim().min(1).optional(),
})
export type ExportInvoicesInput = z.infer<typeof ExportInvoicesSchema>
// Success shape; a partial export is a non-2xx error carrying the durable count.
export type ExportInvoicesResult = { exported: number }

// --- InvoiceEvent ledger ---------------------------------------------------
// Append-only history of meaningful invoice changes, surfaced by the timeline.

export const EventType = z.enum([
  'CREATED',
  'STATUS_CHANGED',
  'FIELD_EDITED',
  'DELETED',
  'IMAGE_ATTACHED',
  'IMAGE_REMOVED',
])
// RECORDED = captured live with the mutation; RECONSTRUCTED = backfilled from an
// existing invoice's fields (pre-ledger) and labelled as inferred in the UI.
export const EventSource = z.enum(['RECORDED', 'RECONSTRUCTED'])

// The events endpoint resolves the acting user to this light display shape.
export const InvoiceEventActorSchema = z.object({ id: z.string(), name: z.string().nullable() })

/**
 * Flat event shape returned by `GET /api/invoices/:id/events`. `detail` is an
 * open record; each event type's concrete detail shape is narrowed at the
 * consumer (the API writer and the web renderer), not as a shared union.
 */
export const InvoiceEventSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  type: EventType,
  source: EventSource,
  detail: z.record(z.string(), z.unknown()),
  actor: InvoiceEventActorSchema,
  createdAt: z.coerce.date(),
})
export const InvoiceEventsResponseSchema = z.object({ data: z.array(InvoiceEventSchema) })

export type EventType = z.infer<typeof EventType>
export type EventSource = z.infer<typeof EventSource>
export type InvoiceEventActor = z.infer<typeof InvoiceEventActorSchema>
export type InvoiceEvent = z.infer<typeof InvoiceEventSchema>
export type InvoiceEventsResponse = z.infer<typeof InvoiceEventsResponseSchema>

// Consumer-side `detail` shapes (type-only — narrowed where read/written).
export type StatusChangedDetail = { from: InvoiceStatus; to: InvoiceStatus }
export type FieldEditedDetail = { field: string; old: string | null; new: string | null }
export type DeletedDetail = { snapshot: Record<string, unknown> }
