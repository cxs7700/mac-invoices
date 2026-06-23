import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ListInvoicesQuerySchema,
  ExportInvoicesSchema,
  InvoiceStatus,
  InvoiceSortField,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { appendRows } from '../integrations/sheets'
import type { GetInvoiceParams, ListInvoicesQuery } from './types.ts'

const userSelect = { select: { id: true, name: true, email: true } }

type PrismaClient = FastifyRequest['server']['prisma']

/**
 * Next sequential invoice number. Existing numbers are numeric strings
 * ("1", "2", ...); take the current max and add one. The column stays a string
 * (no migration), so historical / imported numbers are preserved untouched.
 */
async function nextInvoiceNumber(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.invoice.findMany({ select: { invoiceNumber: true } })
  let max = 0
  for (const { invoiceNumber } of rows) {
    const n = Number.parseInt(invoiceNumber, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'

/**
 * POST /api/invoices — create an invoice owned by the session user. The invoice
 * number is auto-assigned (next sequential) when the client omits it.
 */
export async function createInvoice(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateInvoiceSchema, request.body)
  const prisma = request.server.prisma

  const buildData = (invoiceNumber: string) => ({
    invoiceNumber,
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
  })

  // Client-supplied number: create directly (a duplicate → 409 via errorHandler).
  if (input.invoiceNumber !== undefined) {
    const invoice = await prisma.invoice.create({
      data: buildData(input.invoiceNumber),
      include: { user: userSelect },
    })
    return reply.code(201).send(invoice)
  }

  // Auto-assigned: compute the next number and retry on the rare concurrent
  // collision against the unique constraint rather than surfacing a 409.
  for (let attempt = 0; ; attempt++) {
    try {
      const invoice = await prisma.invoice.create({
        data: buildData(await nextInvoiceNumber(prisma)),
        include: { user: userSelect },
      })
      return reply.code(201).send(invoice)
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue
      throw err
    }
  }
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
  if (q.search) where.description = { contains: q.search, mode: 'insensitive' }

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

// Read per-call so tests can shrink it via EXPORT_CHUNK_SIZE; clamp to [1, 500]
// (0 or negative would make the loop never advance — an infinite loop).
const exportChunk = () => {
  const n = Math.floor(Number(process.env.EXPORT_CHUNK_SIZE ?? 500))
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 500
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)

// The §8 column order — single source of truth (the operator header row in
// docs/SHEETS_EXPORT.md must match this).
const EXPORT_COLUMNS = [
  'id',
  'invoiceNumber',
  'vendorName',
  'amount',
  'status',
  'invoiceDate',
  'dueDate',
  'category',
  'description',
] as const

/**
 * POST /api/invoices/export — append the session user's un-synced invoices to a
 * Google Sheet, then stamp sheetsSyncedAt. Writes in chunks of <=500 and stamps
 * per chunk, so a retry resumes the remainder. Delivery is at-least-once: if the
 * append lands at Google but the function dies before the stamp, the next export
 * re-appends (rows are identifiable by the `id` first column).
 */
export async function exportInvoices(request: FastifyRequest, reply: FastifyReply) {
  const { spreadsheetId: bodyId } = parseBody(ExportInvoicesSchema, request.body)
  const spreadsheetId = bodyId ?? process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) {
    throw new AppError(
      'VALIDATION_ERROR',
      'No target spreadsheet — set GOOGLE_SHEET_ID or pass spreadsheetId',
      400,
    )
  }

  const invoices = await request.server.prisma.invoice.findMany({
    where: { userId: request.user.id, sheetsSyncedAt: null },
    orderBy: { invoiceDate: 'asc' },
  })

  const chunkSize = exportChunk()
  let exported = 0
  for (let i = 0; i < invoices.length; i += chunkSize) {
    const chunk = invoices.slice(i, i + chunkSize)
    const rows = chunk.map((inv) => {
      const cell: Record<(typeof EXPORT_COLUMNS)[number], string | number> = {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        vendorName: inv.vendorName,
        amount: inv.amount.toNumber(),
        status: inv.status,
        invoiceDate: ymd(inv.invoiceDate),
        dueDate: inv.dueDate ? ymd(inv.dueDate) : '',
        category: inv.category,
        description: inv.description,
      }
      return EXPORT_COLUMNS.map((c) => cell[c])
    })

    try {
      // Append THEN stamp in one guarded step: a stamp-side (DB) failure after a
      // successful append must also surface the durable count, not 500.
      await appendRows(spreadsheetId, rows)
      await request.server.prisma.invoice.updateMany({
        where: { id: { in: chunk.map((c) => c.id) }, userId: request.user.id },
        data: { sheetsSyncedAt: new Date() },
      })
    } catch (err) {
      // Surface how many rows are durably exported so a retry resumes the rest;
      // attach the count for any error type, not just AppError.
      if (exported > 0) {
        const code = err instanceof AppError ? err.code : 'EXPORT_INTERRUPTED'
        const message = err instanceof Error ? err.message : 'Export interrupted'
        const status = err instanceof AppError ? err.statusCode : 502
        throw new AppError(code, message, status, { exported })
      }
      throw err
    }
    exported += chunk.length
  }

  return reply.send({ exported })
}
