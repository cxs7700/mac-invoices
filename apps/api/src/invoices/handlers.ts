import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ListInvoicesQuerySchema,
  InvoiceStatus,
  InvoiceSortField,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

const userSelect = { select: { id: true, name: true, email: true } }

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
 * GET /api/invoices — list the session user's invoices: status / date-range
 * (invoiceDate) / vendor (contains) filtering, whitelisted sort, and strict
 * offset pagination. Ownership-scoped to request.user.id.
 */
export async function listInvoices(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply,
) {
  const q = parseBody(ListInvoicesQuerySchema, request.query, 'Invalid query parameters')

  const where: Prisma.InvoiceWhereInput = { userId: request.user.id }
  if (q.status) where.status = q.status
  if (q.from || q.to) {
    const invoiceDate: Prisma.DateTimeFilter = {}
    if (q.from) invoiceDate.gte = q.from
    if (q.to) {
      // `to` is a date-only value coerced to UTC midnight; include the whole day.
      const end = new Date(q.to)
      end.setUTCHours(23, 59, 59, 999)
      invoiceDate.lte = end
    }
    where.invoiceDate = invoiceDate
  }
  if (q.vendor) where.vendorName = { contains: q.vendor, mode: 'insensitive' }

  // Exhaustive map (not a computed-key cast) so a new sort field is a compile
  // error here. invoiceDate desc is the tiebreaker for the nullable dueDate sort.
  const sortClause: Record<InvoiceSortField, Prisma.InvoiceOrderByWithRelationInput> = {
    invoiceDate: { invoiceDate: q.order },
    amount: { amount: q.order },
    dueDate: { dueDate: q.order },
    status: { status: q.order },
  }
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
    sortClause[q.sort],
    { invoiceDate: 'desc' },
  ]

  const [invoices, total] = await Promise.all([
    request.server.prisma.invoice.findMany({
      where,
      include: { user: userSelect },
      take: q.limit,
      skip: q.offset,
      orderBy,
    }),
    request.server.prisma.invoice.count({ where }),
  ])

  return reply.send({ data: invoices, pagination: { total, limit: q.limit, offset: q.offset } })
}

/**
 * GET /api/invoices/stats — totals by status for the session user (all-time,
 * independent of any list filter). Zero-fills every status for a stable shape.
 */
export async function invoiceStats(request: FastifyRequest, reply: FastifyReply) {
  const grouped = await request.server.prisma.invoice.groupBy({
    by: ['status'],
    where: { userId: request.user.id },
    _count: { _all: true },
  })

  // Typed by the shared enum so adding a status is a compile error if missed.
  const counts = {} as Record<InvoiceStatus, number>
  for (const s of InvoiceStatus.options) counts[s] = 0
  let total = 0
  for (const row of grouped) {
    counts[row.status as InvoiceStatus] = row._count._all
    total += row._count._all
  }

  return reply.send({ counts, total })
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
  // The row can be concurrently deleted between updateMany and this re-fetch;
  // guard so we never reply 200 with a null body.
  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }
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
