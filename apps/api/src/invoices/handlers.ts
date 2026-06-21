import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import { CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceStatus } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

// The creating user. Until auth (Phase 3) this is the seeded landlord; the value
// is set server-side and never read from the request body (§7).
// TODO Phase 3: replace with resolveUserId(request) backed by the session.
function getLandlordId(): string {
  const id = process.env.LANDLORD_USER_ID
  if (!id) throw new AppError('CONFIG_ERROR', 'LANDLORD_USER_ID is not configured', 500)
  return id
}

const userSelect = { select: { id: true, name: true, email: true } }

/** Clamp a string query int into [min, max], falling back to `def` on NaN. */
function clampInt(value: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10)
  if (Number.isNaN(n)) return def
  return Math.min(Math.max(n, min), max)
}

/**
 * POST /api/invoices — create an invoice. Body is validated against the shared
 * CreateInvoiceSchema; userId is set server-side to the landlord.
 */
export async function createInvoice(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateInvoiceSchema, request.body)

  const invoice = await request.server.prisma.invoice.create({
    data: {
      invoiceNumber: input.invoiceNumber,
      vendorName: input.vendorName,
      vendorEmail: input.vendorEmail ?? null,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      category: input.category,
      propertyId: input.propertyId ?? null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      user: { connect: { id: getLandlordId() } },
    },
    include: { user: userSelect },
  })

  return reply.code(201).send(invoice)
}

/**
 * GET /api/invoices — list invoices with optional status filter and clamped
 * pagination.
 */
export async function listInvoices(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply,
) {
  const { status, limit, offset } = request.query

  const where: Prisma.InvoiceWhereInput = {}
  if (status) {
    const parsed = InvoiceStatus.safeParse(status)
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', `Invalid status filter: ${status}`, 400)
    }
    where.status = parsed.data
  }

  const take = clampInt(limit, 50, 1, 100)
  const skip = clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const [invoices, total] = await Promise.all([
    request.server.prisma.invoice.findMany({
      where,
      include: { user: userSelect },
      take,
      skip,
      orderBy: { invoiceDate: 'desc' },
    }),
    request.server.prisma.invoice.count({ where }),
  ])

  return reply.send({ data: invoices, pagination: { total, limit: take, offset: skip } })
}

/** GET /api/invoices/:id — get a single invoice by its cuid id. */
export async function getInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoice = await request.server.prisma.invoice.findUnique({
    where: { id: request.params.id },
    include: { user: userSelect },
  })

  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  return reply.send(invoice)
}

/** PATCH /api/invoices/:id — update an invoice (body validated against UpdateInvoiceSchema). */
export async function updateInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateInvoiceSchema, request.body)

  // Build the update data explicitly (mirroring createInvoice) rather than
  // spreading the whole body, so ownership/identity columns can never be set
  // even if the shared schema later grows a userId/id field.
  const data: Prisma.InvoiceUncheckedUpdateInput = {}
  if (input.invoiceNumber !== undefined) data.invoiceNumber = input.invoiceNumber
  if (input.vendorName !== undefined) data.vendorName = input.vendorName
  if (input.vendorEmail !== undefined) data.vendorEmail = input.vendorEmail
  if (input.description !== undefined) data.description = input.description
  if (input.amount !== undefined) data.amount = input.amount
  if (input.currency !== undefined) data.currency = input.currency
  if (input.category !== undefined) data.category = input.category
  if (input.propertyId !== undefined) data.propertyId = input.propertyId
  if (input.invoiceDate !== undefined) data.invoiceDate = input.invoiceDate
  if (input.dueDate !== undefined) data.dueDate = input.dueDate
  if (input.paidDate !== undefined) data.paidDate = input.paidDate
  if (input.notes !== undefined) data.notes = input.notes
  if (input.attachmentUrl !== undefined) data.attachmentUrl = input.attachmentUrl
  if (input.status !== undefined) data.status = input.status

  const invoice = await request.server.prisma.invoice.update({
    where: { id: request.params.id },
    data,
    include: { user: userSelect },
  })

  return reply.send(invoice)
}

/** DELETE /api/invoices/:id — delete an invoice. */
export async function deleteInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  await request.server.prisma.invoice.delete({ where: { id: request.params.id } })
  return reply.code(204).send()
}
