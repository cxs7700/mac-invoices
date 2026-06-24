import type { Prisma, PrismaClient } from '../../prisma/generated/client.ts'
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceImageInput,
  InvoiceStatus,
} from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { isOwnedBy, deleteBlob } from '../integrations/storage'

// --- Status transition guard (KTD-3) ---------------------------------------
// SUBMITTED is the contractor-submission entry state. The guard governs that
// lifecycle specifically; legacy transitions among the pre-existing statuses
// keep their prior freedom (e.g. reopening a PAID invoice clears paidDate), so
// the landlord's existing flows are not regressed (R-8). Actor kind is derived
// from the `contractor:` actorId namespace — no extra parameter threads through
// the shared updateInvoice signature.

type ActorKind = 'landlord' | 'contractor'

function actorKindOf(actorId: string): ActorKind {
  return actorId.startsWith('contractor:') ? 'contractor' : 'landlord'
}

/**
 * Throw 422 on an illegal status transition. Rules:
 * - Nothing may move *into* SUBMITTED (it is created only by a submission).
 * - From SUBMITTED a contractor may only withdraw (→ CANCELLED); a landlord may
 *   only approve (→ APPROVED, requires a category) or reject (→ REJECTED,
 *   requires a reason).
 * - Entering APPROVED from any state requires a category to be set.
 * - All other (legacy, non-SUBMITTED) transitions are permitted unchanged.
 * A no-op (from === to) is not a transition and returns immediately.
 */
export function assertTransitionAllowed(
  actorId: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  ctx: { categoryAfter: unknown; rejectionReason?: string | null },
): void {
  if (from === to) return
  if (to === 'SUBMITTED') {
    throw new AppError('INVALID_TRANSITION', 'An invoice cannot be moved into SUBMITTED', 422)
  }
  if (from === 'SUBMITTED') {
    if (actorKindOf(actorId) === 'contractor') {
      if (to === 'CANCELLED') return
      throw new AppError('INVALID_TRANSITION', `A submission cannot move from SUBMITTED to ${to}`, 422)
    }
    if (to === 'APPROVED') {
      if (ctx.categoryAfter == null) {
        throw new AppError('CATEGORY_REQUIRED', 'Set a category before approving', 422)
      }
      return
    }
    if (to === 'REJECTED') {
      if (!ctx.rejectionReason) {
        throw new AppError('REASON_REQUIRED', 'A rejection reason is required', 422)
      }
      return
    }
    throw new AppError('INVALID_TRANSITION', `A submission can only be approved or rejected, not ${to}`, 422)
  }
  if (to === 'APPROVED' && ctx.categoryAfter == null) {
    throw new AppError('CATEGORY_REQUIRED', 'Set a category before approving', 422)
  }
}

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
    // invoiceNumber is nullable now (contractor submissions are unnumbered until
    // approved) — skip nulls when scanning for the max.
    if (!invoiceNumber) continue
    const n = Number.parseInt(invoiceNumber, 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return String(max + 1)
}

/**
 * KTD-5 gate: a client-supplied blob ref is trusted only if its `owners/<id>/`
 * prefix is the acting user's. The blob is uploaded before the invoice exists, so
 * this prefix check is the access control that stops attaching another user's blob.
 */
function gateImageRef(url: string, ownerId: string): void {
  if (!isOwnedBy(url, ownerId)) {
    throw new AppError('FORBIDDEN', 'That image does not belong to you', 403)
  }
}

// A contractor has two namespaced strings, deliberately kept distinct (KTD-7/8):
// the ledger actor id (`contractor:<id>`) and the blob-prefix owner (`c_<id>`).
// Centralized here so the submit path, the contractor edit path, the public
// upload-token route, and the events resolver all derive them one way and never
// conflate them with each other or with the landlord owner id.
export const contractorActorId = (contractorId: string) => `contractor:${contractorId}`
export const contractorBlobOwner = (contractorId: string) => `c_${contractorId}`

/** Within a transaction: write the single InvoiceImage row + an IMAGE_ATTACHED event. */
async function writeImageAttachment(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  actorId: string,
  ownerUserId: string,
  image: InvoiceImageInput,
): Promise<void> {
  await tx.invoiceImage.create({
    data: { invoiceId, url: image.url, type: image.type, caption: image.caption ?? null },
  })
  await tx.invoiceEvent.create({
    data: {
      invoiceId,
      actorId,
      ownerUserId,
      type: 'IMAGE_ATTACHED',
      detail: { url: image.url, type: image.type },
    },
  })
}

/**
 * Create an invoice and its CREATED event in one transaction. The invoice number
 * is the client-supplied one, or the next sequential number computed on `tx`. When
 * an `image` is supplied (owner-gated), its InvoiceImage row + IMAGE_ATTACHED event
 * are written in the same transaction. Throws P2002 on a number collision — the
 * handler retries auto-numbered creates in a fresh transaction.
 */
export async function createInvoice(
  prisma: PrismaClient,
  actorId: string,
  input: CreateInvoiceInput,
) {
  if (input.image) gateImageRef(input.image.url, actorId)
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
    if (input.image) await writeImageAttachment(tx, invoice.id, actorId, invoice.userId, input.image)
    return invoice
  })
}

/**
 * Create a contractor submission: an invoice OWNED by the landlord but submitted
 * by (and attributed in the ledger to) the contractor. The three identities are
 * distinct (KTD-7/8): `ownerUserId` is the landlord (`user.connect` + the event's
 * ownerUserId), the event `actorId` is `contractor:<id>`, and the image gate uses
 * the contractor's blob prefix `c_<id>` (the uploader). The row lands SUBMITTED,
 * uncategorized, and unnumbered (a number is assigned on approval — KTD-11). The
 * photo is required (the proof) and gated to the contractor's own uploads.
 */
export async function createSubmission(
  prisma: PrismaClient,
  args: { ownerUserId: string; contractorId: string; vendorName: string },
  input: { amount: number; description: string; invoiceDate: Date; image: InvoiceImageInput },
) {
  const actorId = contractorActorId(args.contractorId)
  gateImageRef(input.image.url, contractorBlobOwner(args.contractorId))
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: null,
        vendorName: args.vendorName,
        description: input.description,
        amount: input.amount,
        category: null,
        invoiceDate: input.invoiceDate,
        status: 'SUBMITTED',
        user: { connect: { id: args.ownerUserId } },
        submittedByContractor: { connect: { id: args.contractorId } },
      },
      include: { user: userSelect },
    })
    await tx.invoiceEvent.create({
      data: { invoiceId: invoice.id, actorId, ownerUserId: invoice.userId, type: 'CREATED', detail: {} },
    })
    await writeImageAttachment(tx, invoice.id, actorId, invoice.userId, input.image)
    return invoice
  })
}

/**
 * Contractor edit/withdraw of their OWN still-SUBMITTED submission. This is a
 * distinct path from updateInvoice — NOT a parameterization of it — because
 * updateInvoice scopes ownership by `userId` (the landlord), which a contractor
 * never is. Scoping is by `submittedByContractorId`, and the write is a
 * compare-and-set: the `updateMany` re-asserts `status: 'SUBMITTED'`, so if the
 * landlord approved/rejected in the meantime the update matches zero rows and we
 * return a uniform 409 (landlord action wins the race). The same 409 covers
 * "not yours" and "doesn't exist", so a contractor can't probe other rows.
 */
export async function contractorUpdateSubmission(
  prisma: PrismaClient,
  args: { contractorId: string; invoiceId: string },
  input: { amount?: number; description?: string; invoiceDate?: Date; withdraw?: boolean },
) {
  const actorId = contractorActorId(args.contractorId)
  const locked = () => new AppError('CONFLICT', 'This submission can no longer be changed', 409)
  return prisma.$transaction(async (tx) => {
    const scope = {
      id: args.invoiceId,
      submittedByContractorId: args.contractorId,
      status: 'SUBMITTED' as const,
    }
    const before = await tx.invoice.findFirst({ where: scope })
    if (!before) throw locked()

    const data: Prisma.InvoiceUncheckedUpdateInput = {}
    const events: Prisma.InvoiceEventCreateManyInput[] = []
    const base = { invoiceId: args.invoiceId, actorId, ownerUserId: before.userId }

    if (input.withdraw) {
      data.status = 'CANCELLED'
      events.push({ ...base, type: 'STATUS_CHANGED', detail: { from: 'SUBMITTED', to: 'CANCELLED' } })
    } else {
      const fields: { key: 'amount' | 'description' | 'invoiceDate'; value: unknown }[] = [
        { key: 'amount', value: input.amount },
        { key: 'description', value: input.description },
        { key: 'invoiceDate', value: input.invoiceDate },
      ]
      for (const { key, value } of fields) {
        if (value === undefined) continue
        ;(data as Record<string, unknown>)[key] = value
        const oldValue = normalize(key, (before as Record<string, unknown>)[key])
        const newValue = normalize(key, value)
        if (oldValue !== newValue) {
          events.push({ ...base, type: 'FIELD_EDITED', detail: { field: key, old: oldValue, new: newValue } })
        }
      }
    }

    // Compare-and-set: re-assert SUBMITTED so a concurrent landlord review wins.
    const result = await tx.invoice.updateMany({ where: scope, data })
    if (result.count === 0) throw locked()
    if (events.length > 0) await tx.invoiceEvent.createMany({ data: events })
    return tx.invoice.findFirstOrThrow({ where: { id: args.invoiceId } })
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
      // The category in effect after this update (the landlord may set category
      // and APPROVED in one call). Guard the transition before writing.
      const categoryAfter = input.category !== undefined ? input.category : before.category
      assertTransitionAllowed(actorId, before.status, next, {
        categoryAfter,
        rejectionReason: input.rejectionReason,
      })
      data.status = next
      data.paidDate = next === 'PAID' ? (input.paidDate ?? new Date()) : null
      // Keep rejectionReason consistent with the status: set it on entering
      // REJECTED, clear any stale reason on every other transition.
      data.rejectionReason = next === 'REJECTED' ? (input.rejectionReason ?? null) : null
      // KTD-11: a contractor submission carries no number until it is approved —
      // so withdrawn/rejected submissions never leave gaps in the ledger. Assign
      // the next sequential number on the first transition into APPROVED.
      if (next === 'APPROVED' && before.invoiceNumber === null) {
        data.invoiceNumber = await nextInvoiceNumber(tx)
      }
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

    // Ownership already verified via the scoped pre-read. When the status is
    // transitioning, re-assert the from-status in the write (compare-and-set) so
    // a concurrent transition (e.g. a contractor withdrawing the same instant
    // the landlord approves) can't be silently overwritten — the loser 409s and
    // exactly one terminal state results. Field-only edits update by id directly.
    if (data.status !== undefined) {
      const res = await tx.invoice.updateMany({ where: { id, status: before.status }, data })
      if (res.count === 0) {
        throw new AppError('CONFLICT', 'This invoice was just updated; reload and retry', 409)
      }
    } else {
      await tx.invoice.update({ where: { id }, data })
    }
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
  const imageUrl = await prisma.$transaction(async (tx) => {
    const before = await tx.invoice.findFirst({
      where: { id, userId: actorId },
      include: { images: true },
    })
    if (!before) throw new AppError('NOT_FOUND', 'Invoice not found', 404)

    // Snapshot the scalar invoice plus the image url, so the archive is complete
    // even though the cascade drops the InvoiceImage row with the invoice.
    const { images, user: _user, ...scalar } = before as Record<string, unknown> & {
      images: { url: string }[]
    }
    const url = images[0]?.url ?? null
    await tx.invoiceEvent.create({
      data: {
        invoiceId: id,
        actorId,
        ownerUserId: before.userId,
        type: 'DELETED',
        detail: { snapshot: { ...serializeInvoice(scalar), imageUrl: url } },
      },
    })
    await tx.invoice.deleteMany({ where: { id, userId: actorId } })
    return url
  })
  // Reclaim the blob after the row is gone (best-effort — never fail the delete).
  if (imageUrl) await deleteBlob(imageUrl).catch(() => {})
}

/**
 * Attach (or replace) an invoice's photo. Gates the blob ref by owner (KTD-5),
 * verifies invoice ownership, then in one transaction removes any existing image
 * row and writes the new one + an IMAGE_ATTACHED event. The replaced blob is
 * reclaimed best-effort after commit.
 */
export async function attachImage(
  prisma: PrismaClient,
  actorId: string,
  invoiceId: string,
  image: InvoiceImageInput,
) {
  gateImageRef(image.url, actorId)
  const priorUrl = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId: actorId } })
    if (!invoice) throw new AppError('NOT_FOUND', 'Invoice not found', 404)
    const existing = await tx.invoiceImage.findFirst({ where: { invoiceId } })
    if (existing) await tx.invoiceImage.deleteMany({ where: { invoiceId } })
    await writeImageAttachment(tx, invoiceId, actorId, invoice.userId, image)
    return existing?.url ?? null
  })
  if (priorUrl && priorUrl !== image.url) await deleteBlob(priorUrl).catch(() => {})
}

/** Remove an invoice's photo: delete the row + blob and emit IMAGE_REMOVED. */
export async function removeImage(prisma: PrismaClient, actorId: string, invoiceId: string) {
  const removedUrl = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, userId: actorId } })
    if (!invoice) throw new AppError('NOT_FOUND', 'Invoice not found', 404)
    const existing = await tx.invoiceImage.findFirst({ where: { invoiceId } })
    if (!existing) throw new AppError('NOT_FOUND', 'No photo on this invoice', 404)
    await tx.invoiceImage.deleteMany({ where: { invoiceId } })
    await tx.invoiceEvent.create({
      data: {
        invoiceId,
        actorId,
        ownerUserId: invoice.userId,
        type: 'IMAGE_REMOVED',
        detail: { url: existing.url },
      },
    })
    return existing.url
  })
  await deleteBlob(removedUrl).catch(() => {})
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
