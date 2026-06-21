import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import { AppError } from '../middleware/errorHandler'
import type {
  GetInvoiceParams,
  ListInvoicesQuery,
  CreateInvoiceBody,
  UpdateInvoiceBody,
} from './types.ts'

/** Parse and validate an `:id` path param, or throw a 400 in the standard shape. */
function parseId(id: string): number {
  const invoiceId = parseInt(id, 10)
  if (isNaN(invoiceId)) {
    throw new AppError('BAD_REQUEST', 'Invalid invoice ID', 400)
  }
  return invoiceId
}

/**
 * POST /api/invoices
 * Create a new invoice. Prisma errors (e.g. P2002) propagate to the central
 * error handler, which renders the §7 shape.
 */
export async function createInvoice(
  request: FastifyRequest<{ Body: CreateInvoiceBody }>,
  reply: FastifyReply,
) {
  const { description, date, location, price, status, number, quantity, creatorId } = request.body

  const invoice = await request.server.prisma.invoice.create({
    data: {
      description,
      date: new Date(date),
      location,
      price: typeof price === 'string' ? parseFloat(price) : price,
      status,
      number,
      quantity: quantity ?? null,
      creatorId,
    },
    include: {
      creator: true,
    },
  })

  return reply.code(201).send(invoice)
}

/**
 * GET /api/invoices
 * List invoices with optional filters.
 */
export async function listInvoices(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply,
) {
  const { status, creatorId, limit = '50', offset = '0' } = request.query

  const where: Prisma.InvoiceWhereInput = {}
  if (status) where.status = status
  if (creatorId) where.creatorId = parseInt(creatorId, 10)

  const [invoices, total] = await Promise.all([
    request.server.prisma.invoice.findMany({
      where,
      include: { creator: true },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      orderBy: { date: 'desc' },
    }),
    request.server.prisma.invoice.count({ where }),
  ])

  return reply.send({
    data: invoices,
    pagination: {
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    },
  })
}

/**
 * GET /api/invoices/:id
 * Get a single invoice by ID.
 */
export async function getInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoiceId = parseId(request.params.id)

  const invoice = await request.server.prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { creator: true },
  })

  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  return reply.send(invoice)
}

/**
 * PATCH /api/invoices/:id
 * Update an invoice. A missing row surfaces as Prisma P2025 → 404 via the
 * central handler.
 */
export async function updateInvoice(
  request: FastifyRequest<{
    Params: GetInvoiceParams
    Body: UpdateInvoiceBody
  }>,
  reply: FastifyReply,
) {
  const invoiceId = parseId(request.params.id)

  const updateData: Prisma.InvoiceUncheckedUpdateInput = {}
  const { description, date, location, price, status, number, quantity, creatorId } = request.body

  if (description !== undefined) updateData.description = description
  if (date !== undefined) updateData.date = new Date(date)
  if (location !== undefined) updateData.location = location
  if (price !== undefined) {
    updateData.price = typeof price === 'string' ? parseFloat(price) : price
  }
  if (status !== undefined) updateData.status = status
  if (number !== undefined) updateData.number = number
  if (quantity !== undefined) updateData.quantity = quantity ?? null
  if (creatorId !== undefined) updateData.creatorId = creatorId

  const invoice = await request.server.prisma.invoice.update({
    where: { id: invoiceId },
    data: updateData,
    include: { creator: true },
  })

  return reply.send(invoice)
}

/**
 * DELETE /api/invoices/:id
 * Delete an invoice. A missing row surfaces as Prisma P2025 → 404.
 */
export async function deleteInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoiceId = parseId(request.params.id)

  await request.server.prisma.invoice.delete({
    where: { id: invoiceId },
  })

  return reply.code(204).send()
}
