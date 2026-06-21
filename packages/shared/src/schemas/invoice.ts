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
  invoiceNumber: z.string().min(1).max(50),
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

export type InvoiceStatus = z.infer<typeof InvoiceStatus>
export type InvoiceCategory = z.infer<typeof InvoiceCategory>
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>
