import { z } from 'zod'

export const InvoiceStatus = z.enum(['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'])
export const InvoiceCategory = z.enum([
  'MAINTENANCE',
  'REPAIRS',
  'UTILITIES',
  'SUPPLIES',
  'LABOR',
  'OTHER',
])

export const CreateInvoiceSchema = z.object({
  // Optional: the create form omits it so the server auto-assigns the next
  // sequential number. Still accepted when provided (data import / tests).
  invoiceNumber: z.string().min(1).max(50).optional(),
  vendorName: z.string().min(1).max(100),
  vendorEmail: z.string().email().optional(),
  description: z.string().min(1).max(500),
  // Bounded to the DB column (Decimal(10,2) max 99,999,999.99) so an over-range
  // value returns 400, not a DB overflow -> 500.
  amount: z.number().positive().multipleOf(0.01).lte(99_999_999.99),
  currency: z.string().length(3).default('USD'),
  category: InvoiceCategory,
  propertyId: z.string().optional(),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().max(1000).optional(),
  // Legacy single-attachment URL. The per-invoice photo feature uses the
  // InvoiceImage relation instead; its upload/view UI is a later phase.
  attachmentUrl: z.string().url().optional(),
})

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial().extend({
  status: InvoiceStatus.optional(),
  paidDate: z.coerce.date().optional(),
})

// Sort is a whitelist so the API never builds an `orderBy` from a raw string.
export const InvoiceSortField = z.enum(['invoiceDate', 'amount', 'dueDate', 'status'])
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

// Phase 5 — Google Sheets export. The target sheet defaults to GOOGLE_SHEET_ID
// server-side; an optional spreadsheetId override is accepted (not surfaced in the UI).
export const ExportInvoicesSchema = z.object({
  spreadsheetId: z.string().trim().min(1).optional(),
})
export type ExportInvoicesInput = z.infer<typeof ExportInvoicesSchema>
// Success shape; a partial export is a non-2xx error carrying the durable count.
export type ExportInvoicesResult = { exported: number }
