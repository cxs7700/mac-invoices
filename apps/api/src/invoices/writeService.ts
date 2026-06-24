import type { Prisma, PrismaClient } from '../../prisma/generated/client.ts'
import type { CreateInvoiceInput, UpdateInvoiceInput } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'

// The single choke-point for invoice mutations. Every create / update / delete
// runs inside one `prisma.$transaction` that writes the row AND appends its
// InvoiceEvent(s), so a mutation and its ledger entry commit or roll back
// together. Handlers parse/validate and shape HTTP; all write + event logic
// lives here so no path can mutate an invoice without recording it.

const userSelect = { select: { id: true, name: true, email: true } }

// Financially-material fields whose edits are recorded as FIELD_EDITED events.
// `paidDate` is intentionally excluded — it is an artifact of the status
// transition and is captured by STATUS_CHANGED.
const TRACKED_FIELDS = ['amount', 'vendorName', 'invoiceDate', 'dueDate'] as const

/** Canonical string form of a tracked field, for stable old/new diffing + display. */
function normalize(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (field === 'amount') return (value as { toFixed: (n: number) => string }).toFixed(2)
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Full, JSON-safe snapshot of an invoice for the DELETED tombstone: Decimal
 * `amount` as a fixed-2 string and Dates as ISO strings, so the deleted row
 * round-trips exactly out of the ledger after the invoice is gone.
 */
function serializeInvoice(inv: Record<string, unknown>): Prisma.InputJsonObject {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(inv)) {
    if (value === null || value === undefined) out[key] = null
    else if (key === 'amount') out[key] = (value as { toFixed: (n: number) => string }).toFixed(2)
    else if (value instanceof Date) out[key] = value.toISOString()
    else out[key] = value as string | number | boolean
  }
  return out
}

/**
 * Next sequential invoice number, scanning the current max. Runs on the
 * transaction client so the read-max and the insert stay race-consistent within
 * the same transaction; the auto-number retry (in the handler) opens a fresh
 * transaction per attempt.
 */
async function nextInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.invoice.findMany({ select: { invoiceNumber: true } })
  let max = 0
  for (const { invoiceNumber } of rows) {
    const n = Number.parseInt(invoiceNumber, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}

/**
 * Create an invoice and its CREATED event in one transaction. The invoice number
 * is the client-supplied one, or the next sequential number computed on `tx`.
 * Throws P2002 on a number collision — the handler retries auto-numbered creates
 * in a fresh transaction.
 */
export async function createInvoice(
  prisma: PrismaClient,
  actorId: string,
  input: CreateInvoiceInput,
) {
  return prisma.$transaction(async (tx) => {
    const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(tx))
    const invoice = await tx.invoice.create({
      data: {
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
        user: { connect: { id: actorId } },
      },
      include: { user: userSelect },
    })
    await tx.invoiceEvent.create({
      data: {
        invoiceId: invoice.id,
        actorId,
        ownerUserId: invoice.userId,
        type: 'CREATED',
        detail: {},
      },
    })
    return invoice
  })
}

/**
 * Update an own invoice and append events for the changes, in one transaction.
 * Reads the pre-image first (which both enforces ownership → 404 and supplies
 * old values for diffing). Emits STATUS_CHANGED on a status transition and one
 * FIELD_EDITED per changed tracked field.
 */
export async function updateInvoice(
  prisma: PrismaClient,
  actorId: string,
  id: string,
  input: UpdateInvoiceInput,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.invoice.findFirst({ where: { id, userId: actorId } })
    if (!before) throw new AppError('NOT_FOUND', 'Invoice not found', 404)

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

    const events: Prisma.InvoiceEventCreateManyInput[] = []
    const base = { invoiceId: id, actorId, ownerUserId: before.userId }

    // Apply the status change AND its paidDate side-effect only on a genuine
    // transition — gating on a real change (not merely `status` being present)
    // prevents an idempotent re-submit from silently moving paidDate with no
    // ledger event. paidDate: set on entering PAID (default now), cleared on
    // leaving it.
    if (input.status !== undefined && input.status !== before.status) {
      const next = input.status
      data.status = next
      data.paidDate = next === 'PAID' ? (input.paidDate ?? new Date()) : null
      events.push({ ...base, type: 'STATUS_CHANGED', detail: { from: before.status, to: next } })
    }
    for (const field of TRACKED_FIELDS) {
      if (input[field] === undefined) continue
      const oldValue = normalize(field, (before as Record<string, unknown>)[field])
      const newValue = normalize(field, input[field])
      if (oldValue !== newValue) {
        events.push({ ...base, type: 'FIELD_EDITED', detail: { field, old: oldValue, new: newValue } })
      }
    }

    // Ownership already verified via the scoped pre-read, so update by unique id.
    await tx.invoice.update({ where: { id }, data })
    if (events.length > 0) await tx.invoiceEvent.createMany({ data: events })

    return tx.invoice.findFirstOrThrow({ where: { id }, include: { user: userSelect } })
  })
}

/**
 * Delete an own invoice. In one transaction, append a DELETED event carrying a
 * full snapshot of the final state (the ledger is the archive), then hard-remove
 * the row. The event's non-cascading `invoiceId` lets it outlive the invoice.
 */
export async function deleteInvoice(prisma: PrismaClient, actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.invoice.findFirst({ where: { id, userId: actorId } })
    if (!before) throw new AppError('NOT_FOUND', 'Invoice not found', 404)

    await tx.invoiceEvent.create({
      data: {
        invoiceId: id,
        actorId,
        ownerUserId: before.userId,
        type: 'DELETED',
        detail: { snapshot: serializeInvoice(before as Record<string, unknown>) },
      },
    })
    await tx.invoice.deleteMany({ where: { id, userId: actorId } })
  })
}

/**
 * Stamp invoices as exported to Sheets. A plain `updateMany` (no transaction,
 * no event): the export emits no timeline event (sync-as-event is deferred), so
 * the existing append-then-stamp at-least-once export behavior is preserved.
 */
export async function stampSynced(prisma: PrismaClient, ownerUserId: string, ids: string[]) {
  await prisma.invoice.updateMany({
    where: { id: { in: ids }, userId: ownerUserId },
    data: { sheetsSyncedAt: new Date() },
  })
}
