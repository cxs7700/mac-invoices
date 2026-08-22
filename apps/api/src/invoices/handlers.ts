import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Prisma } from '../../prisma/generated/client.ts'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  ListInvoicesQuerySchema,
  SummaryQuerySchema,
  ExportInvoicesSchema,
  AttachImageSchema,
  SetImageTypeSchema,
  ImageUploadTokenSchema,
  InvoiceStatus,
  InvoiceCategory,
  InvoiceSortField,
  compareInvoiceOrder,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { parseBody } from '../lib/validate'
import { money } from '../lib/money'
import { issueUploadToken, signedReadUrl } from '../integrations/storage'
import { assertCronSecret } from '../lib/cronAuth'
import * as writeService from './writeService'
import { mirrorUserSheet, runSheetsSyncFlush } from './sheetSync'
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

const listInclude = {
  user: userSelect,
  items: { orderBy: { sortOrder: 'asc' } },
  // Two distinct relations, deliberately both surfaced under their own
  // keys (see writeService.resolveVendorId / createSubmission):
  //  - `vendor` is ATTRIBUTION (Invoice.vendorId) — "who this invoice is
  //    from". Set on every landlord-entered invoice with a resolved/
  //    auto-created vendor, and on a self-submission too. This is what
  //    the PDF "Sender" block (U8) consumes.
  //  - `submittedByVendor` is PROVENANCE — who submitted it via their
  //    no-login link, if anyone. Null for a landlord-entered invoice.
  // Do not flatten one into the other: a landlord-entered invoice has
  // vendor set and submittedByVendor null, while a self-submission has
  // both set to the same vendor.
  vendor: { select: { name: true, phone: true, email: true } },
  submittedByVendor: { select: { name: true, phone: true, email: true } },
  _count: { select: { images: true } },
} satisfies Prisma.InvoiceInclude

/**
 * One page of invoices ordered by invoice number, natural (numeric-aware) —
 * DEC-023 keeps the column a nullable string, so a SQL `ORDER BY` would put
 * "10" before "9" and scatter the un-numbered submissions. Ordering therefore
 * runs in memory over an id/number/date projection of the filtered set, using
 * the same `compareInvoiceOrder` the Sheets mirror and the PDF export use, so
 * the three surfaces can never disagree; only the page's rows are then fetched
 * with the full include. The projection is bounded by the tenant's own invoice
 * count (the same bound `nextInvoiceNumber` already scans).
 *
 * `desc` is the exact reverse of `asc`, which puts the un-numbered submissions
 * (numbered on first APPROVED, KTD-11) first rather than last.
 */
async function listPageByInvoiceNumber(
  prisma: FastifyRequest['server']['prisma'],
  where: Prisma.InvoiceWhereInput,
  q: { order: 'asc' | 'desc'; limit: number; offset: number },
) {
  const keys = await prisma.invoice.findMany({
    where,
    select: { id: true, invoiceNumber: true, invoiceDate: true },
  })
  keys.sort(compareInvoiceOrder)
  if (q.order === 'desc') keys.reverse()

  const pageIds = keys.slice(q.offset, q.offset + q.limit).map((k) => k.id)
  // Scope is already enforced: these ids come out of the caller's own `where`.
  const rows = await prisma.invoice.findMany({
    where: { id: { in: pageIds } },
    include: listInclude,
  })
  // `IN` returns rows in no particular order — restore the sorted order.
  const byId = new Map(rows.map((r) => [r.id, r]))
  const page = pageIds.flatMap((id) => byId.get(id) ?? [])
  return [page, keys.length] as const
}

/**
 * The invoiceDate clause a from/to window resolves to, or undefined for an
 * unbounded window. `to` is a date-only value coerced to UTC midnight, so the
 * whole day is included. Shared by the list and the dashboard summary so one
 * lookback means the same rows in both.
 */
function invoiceDateFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  const invoiceDate: Prisma.DateTimeFilter = {}
  if (from) invoiceDate.gte = from
  if (to) {
    const end = new Date(to)
    end.setUTCHours(23, 59, 59, 999)
    invoiceDate.lte = end
  }
  return invoiceDate
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
  const invoiceDate = invoiceDateFilter(q.from, q.to)
  if (invoiceDate) where.invoiceDate = invoiceDate
  if (q.vendor) where.vendorName = { contains: q.vendor, mode: 'insensitive' }
  // Description moved from a column to items — search matches any item's
  // description on the invoice.
  if (q.search) where.items = { some: { description: { contains: q.search, mode: 'insensitive' } } }
  // Property filter: "none" → the unassigned bucket; any other value → that
  // property. Appended to the userId-anchored where, so scope is preserved.
  if (q.propertyId) where.propertyId = q.propertyId === 'none' ? null : q.propertyId

  // Exhaustive map (not a computed-key cast) so a new sort field is a compile
  // error here. invoiceDate desc is the secondary tiebreaker. `invoiceNumber`
  // has no SQL clause on purpose — it is ordered in memory below.
  const sortClause: Record<
    Exclude<InvoiceSortField, 'invoiceNumber'>,
    Prisma.InvoiceOrderByWithRelationInput
  > = {
    invoiceDate: { invoiceDate: q.order },
    amount: { amount: q.order },
    status: { status: q.order },
  }

  const [invoices, total] =
    q.sort === 'invoiceNumber'
      ? await listPageByInvoiceNumber(request.server.prisma, where, q)
      : await Promise.all([
          request.server.prisma.invoice.findMany({
            where,
            include: listInclude,
            take: q.limit,
            skip: q.offset,
            orderBy: [sortClause[q.sort], { invoiceDate: 'desc' }],
          }),
          request.server.prisma.invoice.count({ where }),
        ])

  // Expose imageCount (cheap _count, no N+1) so the list can render the add-photo
  // indicator without fetching each invoice's image rows. Drop the raw _count.
  const data = invoices.map(({ _count, ...inv }) => ({
    ...inv,
    imageCount: _count.images,
  }))
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
 * GET /api/invoices/summary — spend for the dashboard: the grand total (count +
 * summed amount), per-category and per-status breakdowns, plus a month-by-month
 * series for the trend chart. Amounts are Decimal-safe strings; every
 * category/status is zero-filled for a stable shape.
 *
 * Optional `from`/`to` narrow every figure to one invoiceDate window — the same
 * lookback the list offers, so the dashboard and the list agree. No bounds means
 * all-time (the original behaviour).
 */
export async function invoiceSummary(
  request: FastifyRequest<{ Querystring: ListInvoicesQuery }>,
  reply: FastifyReply,
) {
  const prisma = request.server.prisma
  const q = parseBody(SummaryQuerySchema, request.query, 'Invalid query parameters')
  const window = invoiceDateFilter(q.from, q.to)
  // "Spend" is real committed money: PENDING / APPROVED / PAID. SUBMITTED
  // (un-vetted), REJECTED (declined) and CANCELLED (withdrawn) are excluded from
  // the grand total and the per-category breakdown — these are exactly the
  // statuses that can carry a null category (a vendor submission), so
  // excluding them also keeps byCategory reconciled with the total (no stray
  // null-category bucket). byStatus KEEPS every status — its SUBMITTED count is
  // the landlord's "to review" signal.
  const owned: Prisma.InvoiceWhereInput = {
    userId: request.user.id,
    ...(window ? { invoiceDate: window } : {}),
  }
  const spend: Prisma.InvoiceWhereInput = {
    ...owned,
    status: { notIn: ['SUBMITTED', 'REJECTED', 'CANCELLED'] },
  }

  const [agg, byCat, byStat, spendRows] = await Promise.all([
    prisma.invoice.aggregate({ where: spend, _sum: { amount: true }, _count: { _all: true } }),
    prisma.invoice.groupBy({
      by: ['category'],
      where: spend,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: owned,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // Prisma can't group by a truncated date, and one landlord's invoices are a
    // small set — so the monthly buckets are rolled up here from (date, amount)
    // pairs rather than in a raw SQL date_trunc.
    prisma.invoice.findMany({
      where: spend,
      select: { invoiceDate: true, amount: true },
      orderBy: { invoiceDate: 'asc' },
    }),
  ])

  const catMap = new Map(
    byCat.map((r) => [r.category, { count: r._count._all, amount: money(r._sum.amount) }]),
  )
  const statMap = new Map(
    byStat.map((r) => [r.status, { count: r._count._all, amount: money(r._sum.amount) }]),
  )

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
    byMonth: monthlySpend(spendRows),
  })
}

/** UTC `YYYY-MM` for an invoiceDate (stored as UTC midnight — see the list filter). */
const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

/**
 * Date-ordered spend rows → one bucket per calendar month, gaps zero-filled so a
 * quiet month reads as a gap in the trend rather than closing up. Amounts are
 * summed as Decimals (never floats) and rendered 2dp, like every other total.
 */
function monthlySpend(
  rows: { invoiceDate: Date; amount: Prisma.Decimal }[],
): { month: string; count: number; amount: string }[] {
  if (rows.length === 0) return []
  const sums = new Map<string, { count: number; amount: Prisma.Decimal }>()
  for (const row of rows) {
    const key = monthKey(row.invoiceDate)
    const bucket = sums.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.amount = bucket.amount.add(row.amount)
    } else {
      sums.set(key, { count: 1, amount: row.amount })
    }
  }

  const first = rows[0].invoiceDate
  const last = rows[rows.length - 1].invoiceDate
  const out: { month: string; count: number; amount: string }[] = []
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1))
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1)
  while (cursor.getTime() <= end) {
    const key = monthKey(cursor)
    const bucket = sums.get(key)
    out.push({ month: key, count: bucket?.count ?? 0, amount: money(bucket?.amount ?? null) })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return out
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
      items: { orderBy: { sortOrder: 'asc' } },
      // Attribution vendor (Invoice.vendorId) — additive, so the detail
      // response agrees with listInvoices. `submitterName` below keeps its
      // existing, distinct meaning (the no-login-link submitter).
      vendor: { select: { name: true, phone: true, email: true } },
      submittedByVendor: { select: { name: true } },
      _count: { select: { images: true } },
    },
  })

  if (!invoice) {
    throw new AppError('NOT_FOUND', 'Invoice not found', 404)
  }

  // Surface the submitter's name on the detail (R11 — "by whom"); strip the
  // joined relation object in favour of a flat field. imageCount drives the
  // add-photo indicator + gallery presence without embedding the image rows here.
  // `vendor` (attribution) passes through as-is via `...rest`.
  const { submittedByVendor, _count, ...rest } = invoice
  return reply.send({
    ...rest,
    submitterName: submittedByVendor?.name ?? null,
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

  // Actor ids are either a user id (landlord) or a `vendor:<id>` namespace
  // (a vendor who submitted/edited). Resolve each kind to a display name.
  // Vendors are scoped to this landlord, so a vendor name never leaks
  // across owners.
  const actorIds = [...new Set(events.map((e) => e.actorId))]
  const vendorPrefix = 'vendor:'
  const userIds = actorIds.filter((id) => !id.startsWith(vendorPrefix))
  const vendorIds = actorIds
    .filter((id) => id.startsWith(vendorPrefix))
    .map((id) => id.slice(vendorPrefix.length))

  const [users, vendors] = await Promise.all([
    userIds.length
      ? request.server.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [],
    vendorIds.length
      ? request.server.prisma.vendor.findMany({
          where: { id: { in: vendorIds }, landlordId: request.user.id },
          select: { id: true, name: true },
        })
      : [],
  ])
  const nameById = new Map<string, string | null>(users.map((u) => [u.id, u.name]))
  for (const v of vendors) nameById.set(`${vendorPrefix}${v.id}`, v.name)

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
  const data = await Promise.all(
    invoice.images.map(async (img) => ({
      id: img.id,
      url: await signedReadUrl(img.url),
      type: img.type,
      caption: img.caption,
      createdAt: img.createdAt,
    })),
  )
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

/**
 * POST /api/invoices/export — "Sync now": full-mirror the session user's
 * invoices to their connected Google Sheet (clear + rewrite). Continuous sync
 * (the cron) does this automatically; this endpoint forces an immediate pass.
 *
 * Targets the user's saved spreadsheet id (Settings) only — there is no
 * server-side fallback. The body `spreadsheetId` is still accepted/validated
 * for compatibility but is no longer an override — the mirror is
 * owner-scoped. Returns `{ exported }` = data rows written.
 */
export async function exportInvoices(request: FastifyRequest, reply: FastifyReply) {
  parseBody(ExportInvoicesSchema, request.body)
  const saved = (
    await request.server.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { sheetSpreadsheetId: true },
    })
  )?.sheetSpreadsheetId
  const spreadsheetId = saved ?? null
  if (!spreadsheetId) {
    throw new AppError(
      'SHEET_NOT_CONNECTED',
      'No target spreadsheet — connect a sheet in Settings',
      400,
    )
  }

  const exported = await mirrorUserSheet(
    request.server.prisma,
    request.user.id,
    spreadsheetId,
    request.log,
  )
  return reply.send({ exported })
}

/**
 * POST /api/cron/sync-sheets — run the continuous Sheets-sync flush across every
 * connected landlord whose data changed since their last sync. PUBLIC but
 * CRON_SECRET-gated (an external scheduler calls it, not a session); fails
 * closed. Idempotent: a re-fire of an already-mirrored, unchanged user skips.
 */
export async function cronSyncSheets(request: FastifyRequest, reply: FastifyReply) {
  assertCronSecret(request)
  const summary = await runSheetsSyncFlush(request.server.prisma, request.log)
  return reply.send(summary)
}
