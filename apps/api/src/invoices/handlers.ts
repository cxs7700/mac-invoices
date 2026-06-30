import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ListInvoicesQuerySchema,
  ExportInvoicesSchema,
  AttachImageSchema,
  SetImageTypeSchema,
  ImageUploadTokenSchema,
  InvoiceStatus,
  InvoiceCategory,
  InvoiceSortField,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { money } from '../lib/money'
import { appendRows } from '../integrations/sheets'
import { issueUploadToken, signedReadUrl } from '../integrations/storage'
import * as writeService from './writeService'
import type { GetInvoiceParams, ImageParams, ListInvoicesQuery } from './types.ts'

const userSelect = { select: { id: true, name: true, email: true } }

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'

/**
 * POST /api/invoices — create an invoice owned by the session user (with a
 * CREATED ledger event). The invoice number is auto-assigned (next sequential)
 * when the client omits it; auto-numbered creates retry the rare concurrent
 * collision, each attempt in a fresh transaction (see writeService).
 */
export async function createInvoice(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(CreateInvoiceSchema, request.body)
  const prisma = request.server.prisma
  const actorId = request.user.id

  // Client-supplied number: a duplicate → 409 via errorHandler (no retry).
  if (input.invoiceNumber !== undefined) {
    const invoice = await writeService.createInvoice(prisma, actorId, input)
    return reply.code(201).send(invoice)
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const invoice = await writeService.createInvoice(prisma, actorId, input)
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
  // Property filter: "none" → the unassigned bucket; any other value → that
  // property. Appended to the userId-anchored where, so scope is preserved.
  if (q.propertyId) where.propertyId = q.propertyId === 'none' ? null : q.propertyId

  // Exhaustive map (not a computed-key cast) so a new sort field is a compile
  // error here. invoiceDate desc is the secondary tiebreaker.
  const sortClause: Record<InvoiceSortField, Prisma.InvoiceOrderByWithRelationInput> = {
    invoiceDate: { invoiceDate: q.order },
    amount: { amount: q.order },
    status: { status: q.order },
  }
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
    sortClause[q.sort],
    { invoiceDate: 'desc' },
  ]

  const [invoices, total] = await Promise.all([
    request.server.prisma.invoice.findMany({
      where,
      include: { user: userSelect, _count: { select: { images: true } } },
      take: q.limit,
      skip: q.offset,
      orderBy,
    }),
    request.server.prisma.invoice.count({ where }),
  ])

  // Expose imageCount (cheap _count, no N+1) so the list can render the add-photo
  // indicator without fetching each invoice's image rows. Drop the raw _count.
  const data = invoices.map(({ _count, ...inv }) => ({ ...inv, imageCount: _count.images }))
  return reply.send({ data, pagination: { total, limit: q.limit, offset: q.offset } })
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

/**
 * GET /api/invoices/summary — all-time spend for the dashboard: the grand total
 * (count + summed amount) plus per-category and per-status breakdowns. Amounts are
 * Decimal-safe strings; every category/status is zero-filled for a stable shape.
 */
export async function invoiceSummary(request: FastifyRequest, reply: FastifyReply) {
  const prisma = request.server.prisma
  // "Spend" is real committed money: PENDING / APPROVED / PAID. SUBMITTED
  // (un-vetted), REJECTED (declined) and CANCELLED (withdrawn) are excluded from
  // the grand total and the per-category breakdown — these are exactly the
  // statuses that can carry a null category (a contractor submission), so
  // excluding them also keeps byCategory reconciled with the total (no stray
  // null-category bucket). byStatus KEEPS every status — its SUBMITTED count is
  // the landlord's "to review" signal.
  const owned = { userId: request.user.id }
  const spend: Prisma.InvoiceWhereInput = {
    ...owned,
    status: { notIn: ['SUBMITTED', 'REJECTED', 'CANCELLED'] },
  }

  const [agg, byCat, byStat] = await Promise.all([
    prisma.invoice.aggregate({ where: spend, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ['category'], where: spend, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ['status'], where: owned, _sum: { amount: true }, _count: { _all: true } }),
  ])

  const catMap = new Map(byCat.map((r) => [r.category, { count: r._count._all, amount: money(r._sum.amount) }]))
  const statMap = new Map(byStat.map((r) => [r.status, { count: r._count._all, amount: money(r._sum.amount) }]))

  return reply.send({
    total: { count: agg._count._all, amount: money(agg._sum.amount) },
    byCategory: InvoiceCategory.options.map((category) => ({
      category,
      ...(catMap.get(category) ?? { count: 0, amount: '0.00' }),
    })),
    byStatus: InvoiceStatus.options.map((status) => ({
      status,
      ...(statMap.get(status) ?? { count: 0, amount: '0.00' }),
    })),
  })
}

/** GET /api/invoices/:id — own invoice, or 404 (no existence leak for others'). */
export async function getInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoice = await request.server.prisma.invoice.findFirst({
    where: { id: request.params.id, userId: request.user.id },
    include: {
      user: userSelect,
      submittedByContractor: { select: { name: true } },
      _count: { select: { images: true } },
    },
  })

  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  // Surface the submitter's name on the detail (R11 — "by whom"); strip the
  // joined relation object in favour of a flat field. imageCount drives the
  // add-photo indicator + gallery presence without embedding the image rows here.
  const { submittedByContractor, _count, ...rest } = invoice
  return reply.send({
    ...rest,
    submitterName: submittedByContractor?.name ?? null,
    imageCount: _count.images,
  })
}

/**
 * GET /api/invoices/:id/events — the invoice's ledger history, oldest-first.
 * Scoped by the event's ownerUserId (not the invoice), so a deleted invoice's
 * events stay retrievable by their owner and a non-owner sees an empty list
 * (no existence leak). Each event's actor is resolved to a light {id, name}.
 */
export async function listInvoiceEvents(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const events = await request.server.prisma.invoiceEvent.findMany({
    where: { invoiceId: request.params.id, ownerUserId: request.user.id },
    orderBy: { createdAt: 'asc' },
  })

  // Actor ids are either a user id (landlord) or a `contractor:<id>` namespace
  // (a contractor who submitted/edited). Resolve each kind to a display name.
  // Contractors are scoped to this landlord, so a contractor name never leaks
  // across owners.
  const actorIds = [...new Set(events.map((e) => e.actorId))]
  const contractorPrefix = 'contractor:'
  const userIds = actorIds.filter((id) => !id.startsWith(contractorPrefix))
  const contractorIds = actorIds
    .filter((id) => id.startsWith(contractorPrefix))
    .map((id) => id.slice(contractorPrefix.length))

  const [users, contractors] = await Promise.all([
    userIds.length
      ? request.server.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    contractorIds.length
      ? request.server.prisma.contractor.findMany({
          where: { id: { in: contractorIds }, landlordId: request.user.id },
          select: { id: true, name: true },
        })
      : [],
  ])
  const nameById = new Map<string, string | null>(users.map((u) => [u.id, u.name]))
  for (const c of contractors) nameById.set(`${contractorPrefix}${c.id}`, c.name)

  const data = events.map((e) => ({
    id: e.id,
    invoiceId: e.invoiceId,
    type: e.type,
    source: e.source,
    detail: e.detail,
    actor: { id: e.actorId, name: nameById.get(e.actorId) ?? null },
    createdAt: e.createdAt,
  }))

  return reply.send({ data })
}

/**
 * PATCH /api/invoices/:id — update an own invoice and record the change in the
 * ledger. Ownership, the old→new diff, and the events are handled atomically in
 * writeService (one transaction); a missing/non-owned row → 404.
 */
export async function updateInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const input = parseBody(UpdateInvoiceSchema, request.body)
  // Approving a submission assigns its invoice number (KTD-11); retry the rare
  // concurrent-approve number collision in a fresh transaction.
  for (let attempt = 0; ; attempt++) {
    try {
      const invoice = await writeService.updateInvoice(
        request.server.prisma,
        request.user.id,
        request.params.id,
        input,
      )
      return reply.send(invoice)
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue
      throw err
    }
  }
}

/**
 * DELETE /api/invoices/:id — delete an own invoice (404 if absent/non-owned).
 * The hard delete and a DELETED tombstone event (carrying a full snapshot) are
 * written atomically in writeService; the event survives the row.
 */
export async function deleteInvoice(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  await writeService.deleteInvoice(request.server.prisma, request.user.id, request.params.id)
  return reply.code(204).send()
}

/**
 * POST /api/invoices/image-upload-token — a short-lived token scoped to the
 * session user's storage prefix, so the client can upload a photo directly to
 * Blob (browser→storage, bypassing the 60s function limit).
 */
export async function createImageUploadToken(request: FastifyRequest, reply: FastifyReply) {
  const { contentType } = parseBody(ImageUploadTokenSchema, request.body)
  const result = await issueUploadToken(request.user.id, contentType)
  return reply.send(result)
}

/**
 * GET /api/invoices/:id/images — the invoice's photo gallery, ownership-scoped
 * (404 for a non-owned/absent invoice). Each row carries a freshly-signed read
 * URL minted at read time (the stored value is the private blob path).
 */
export async function listInvoiceImages(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const invoice = await request.server.prisma.invoice.findFirst({
    where: { id: request.params.id, userId: request.user.id },
    include: { images: { orderBy: { createdAt: 'asc' } } },
  })
  if (!invoice) throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  const data = invoice.images.map((img) => ({
    id: img.id,
    url: signedReadUrl(img.url),
    type: img.type,
    caption: img.caption,
    createdAt: img.createdAt,
  }))
  return reply.send({ data })
}

/** POST /api/invoices/:id/images — append a photo to the gallery (ledger-recorded). */
export async function addInvoiceImage(
  request: FastifyRequest<{ Params: GetInvoiceParams }>,
  reply: FastifyReply,
) {
  const image = parseBody(AttachImageSchema, request.body)
  await writeService.addImage(request.server.prisma, request.user.id, request.params.id, image)
  return reply.code(204).send()
}

/** DELETE /api/invoices/:id/images/:imageId — remove one photo by id (ledger-recorded). */
export async function removeInvoiceImage(
  request: FastifyRequest<{ Params: ImageParams }>,
  reply: FastifyReply,
) {
  await writeService.removeImage(
    request.server.prisma,
    request.user.id,
    request.params.id,
    request.params.imageId,
  )
  return reply.code(204).send()
}

/** PATCH /api/invoices/:id/images/:imageId — change one photo's type. */
export async function setInvoiceImageType(
  request: FastifyRequest<{ Params: ImageParams }>,
  reply: FastifyReply,
) {
  const { type } = parseBody(SetImageTypeSchema, request.body)
  await writeService.setImageType(
    request.server.prisma,
    request.user.id,
    request.params.id,
    request.params.imageId,
    type,
  )
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
  'category',
  'description',
  'propertyAddress',
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
  // Target resolution: an explicit body override, else the landlord's saved
  // spreadsheet id (Settings), else the server env default.
  const saved = (
    await request.server.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { sheetSpreadsheetId: true },
    })
  )?.sheetSpreadsheetId
  const spreadsheetId = bodyId ?? saved ?? process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) {
    throw new AppError(
      'VALIDATION_ERROR',
      'No target spreadsheet — set GOOGLE_SHEET_ID or pass spreadsheetId',
      400,
    )
  }

  const invoices = await request.server.prisma.invoice.findMany({
    // Only real spend syncs to the accounting sheet (KTD-9): SUBMITTED (un-vetted),
    // REJECTED (declined) and CANCELLED (withdrawn) are never exported. A later
    // approval re-qualifies the row (it was never stamped) and assigns its number.
    where: {
      userId: request.user.id,
      sheetsSyncedAt: null,
      status: { notIn: ['SUBMITTED', 'REJECTED', 'CANCELLED'] },
    },
    // The assigned property's address rides along as an export column (empty when
    // the invoice has no property).
    include: { property: { select: { address: true } } },
    orderBy: { invoiceDate: 'asc' },
  })

  const chunkSize = exportChunk()
  let exported = 0
  for (let i = 0; i < invoices.length; i += chunkSize) {
    const chunk = invoices.slice(i, i + chunkSize)
    const rows = chunk.map((inv) => {
      const cell: Record<(typeof EXPORT_COLUMNS)[number], string | number> = {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? '',
        vendorName: inv.vendorName,
        amount: inv.amount.toNumber(),
        status: inv.status,
        invoiceDate: ymd(inv.invoiceDate),
        category: inv.category ?? '',
        description: inv.description,
        propertyAddress: inv.property?.address ?? '',
      }
      return EXPORT_COLUMNS.map((c) => cell[c])
    })

    try {
      // Append THEN stamp in one guarded step: a stamp-side (DB) failure after a
      // successful append must also surface the durable count, not 500.
      await appendRows(spreadsheetId, rows)
      await writeService.stampSynced(
        request.server.prisma,
        request.user.id,
        chunk.map((c) => c.id),
      )
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
