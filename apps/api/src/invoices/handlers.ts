import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import { CreateInvoiceSchema, UpdateInvoiceSchema, InvoiceStatus } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

const userSelect = { select: { id: true, name: true, email: true } }

/** Clamp a string query int into [min, max], falling back to `def` on NaN. */
function clampInt(value: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10)
  if (Number.isNaN(n)) return def
  return Math.min(Math.max(n, min), max)
}

/**
 * POST /api/invoices — create an invoice owned by the session user.
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
      user: { connect: { id: request.user.id } },
    },
    include: { user: userSelect },
  })

  return reply.code(201).send(invoice)
}

/**
 * GET /api/invoices — list the session user's invoices (status filter + clamped
 * pagination). Date/vendor filtering and sort are Phase 4.
 */
export async function listInvoices(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply,
) {
  const { status, limit, offset } = request.query

  const where: Prisma.InvoiceWhereInput = { userId: request.user.id }
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

/** GET /api/invoices/:id — own invoice, or 404 (no existence leak for others'). */
export async function getInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoice = await request.server.prisma.invoice.findFirst({
    where: { id: request.params.id, userId: request.user.id },
    include: { user: userSelect },
  })

  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  return reply.send(invoice)
}

/**
 * PATCH /api/invoices/:id — update an own invoice. Ownership is enforced via
 * updateMany({ id, userId }) (a non-unique where Prisma's `update` can't take);
 * count === 0 means not found / not owned → 404.
 */
export async function updateInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateInvoiceSchema, request.body)

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
  if (input.notes !== undefined) data.notes = input.notes
  if (input.attachmentUrl !== undefined) data.attachmentUrl = input.attachmentUrl
  // paidDate is only consistent relative to status: set it on the PAID transition
  // (default now), clear it when leaving PAID; never trust a standalone paidDate.
  if (input.status !== undefined) {
    data.status = input.status
    data.paidDate = input.status === 'PAID' ? (input.paidDate ?? new Date()) : null
  }

  const result = await request.server.prisma.invoice.updateMany({
    where: { id: request.params.id, userId: request.user.id },
    data,
  })
  if (result.count === 0) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  const invoice = await request.server.prisma.invoice.findFirst({
    where: { id: request.params.id, userId: request.user.id },
    include: { user: userSelect },
  })
  return reply.send(invoice)
}

/** DELETE /api/invoices/:id — delete an own invoice (count === 0 → 404). */
export async function deleteInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const result = await request.server.prisma.invoice.deleteMany({
    where: { id: request.params.id, userId: request.user.id },
  })
  if (result.count === 0) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }
  return reply.code(204).send()
}
