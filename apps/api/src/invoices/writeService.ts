import type { Prisma, PrismaClient } from '../../prisma/generated/client.ts'
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  InvoiceImageInput,
  InvoiceItemInput,
  InvoiceStatus,
  InvoiceCategory,
} from '@mac-invoices/shared'
import { MAX_INVOICE_IMAGES } from '@mac-invoices/shared'
import { AppError } from '../middleware/errorHandler'
import { isOwnedBy, deleteBlob } from '../integrations/storage'
import { isUniqueViolation } from '../vendors/handlers'
import { newLookupId } from '../vendors/token'

// --- Item totals (KTD: amount is a server-computed sum, Decimal-safe) ------
// Sum in integer cents, not floats — each item's `total` is already
// zod-bounded to 2 decimals, but summing as JS numbers can still accumulate
// float error (the codebase avoids float money elsewhere too — DEC-002).

function toCents(n: number): number {
  return Math.round(n * 100)
}

/** Sum of item totals, as a number with exactly 2 decimals (safe to hand to
 * Prisma's Decimal(10,2) column). Throws 400 if the sum overflows the column. */
function sumItemTotals(items: readonly InvoiceItemInput[]): number {
  const cents = items.reduce((sum, item) => sum + toCents(item.total), 0)
  const amount = cents / 100
  if (amount > 99_999_999.99) {
    throw new AppError('VALIDATION_ERROR', 'The sum of item totals is too large', 400)
  }
  return amount
}

/** Item rows for a nested `items: { createMany: { data } }` write (no
 * `invoiceId` — Prisma infers it from the relation), items in submitted order
 * (sortOrder = array index). */
function nestedItemRows(items: readonly InvoiceItemInput[]) {
  return items.map((item, sortOrder) => ({
    description: item.description,
    quantity: item.quantity,
    total: item.total,
    sortOrder,
  }))
}

/** Item rows for a standalone `invoiceItem.createMany` write (explicit
 * `invoiceId`), used when the write isn't nested under `invoice.create`. */
function itemRows(invoiceId: string, items: readonly InvoiceItemInput[]) {
  return nestedItemRows(items).map((row) => ({ invoiceId, ...row }))
}

// --- Status transition guard (KTD-3) ---------------------------------------
// SUBMITTED is the vendor-submission entry state. The guard governs that
// lifecycle specifically; legacy transitions among the pre-existing statuses
// keep their prior freedom (e.g. reopening a PAID invoice clears paidDate), so
// the landlord's existing flows are not regressed (R-8). Actor kind is derived
// from the `vendor:` actorId namespace — no extra parameter threads through
// the shared updateInvoice signature.

type ActorKind = 'landlord' | 'vendor'

function actorKindOf(actorId: string): ActorKind {
  return actorId.startsWith('vendor:') ? 'vendor' : 'landlord'
}

/**
 * Throw 422 on an illegal status transition. Rules:
 * - Nothing may move *into* SUBMITTED (it is created only by a submission).
 * - From SUBMITTED a vendor may only withdraw (→ CANCELLED); a landlord may
 *   only approve (→ PAID, requires a category and a property) or reject
 *   (→ REJECTED, requires a reason).
 * - All other (legacy, non-SUBMITTED) transitions are permitted unchanged —
 *   including PAID → PENDING ("mark as unpaid") and plain mark-as-paid, which
 *   deliberately do NOT require a category/property (pre-existing landlord
 *   freedom; the requirement bites only when reviewing a vendor submission).
 * A no-op (from === to) is not a transition and returns immediately.
 */
export function assertTransitionAllowed(
  actorId: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  ctx: { categoryAfter: unknown; propertyIdAfter: unknown; rejectionReason?: string | null },
): void {
  if (from === to) return
  if (to === 'SUBMITTED') {
    throw new AppError('INVALID_TRANSITION', 'An invoice cannot be moved into SUBMITTED', 422)
  }
  // CANCELLED (withdrawn) and REJECTED (declined) are terminal — nothing moves
  // out of them (a correction is a brand-new submission). This is also what makes
  // the withdraw-vs-approve race single-winner: if a withdraw commits first, the
  // landlord's approve sees CANCELLED and is refused here rather than resurrecting
  // it to PAID. (PAID stays reopenable — existing landlord behavior.)
  if (from === 'CANCELLED' || from === 'REJECTED') {
    throw new AppError(
      'INVALID_TRANSITION',
      `A ${from.toLowerCase()} invoice cannot change status`,
      422,
    )
  }
  if (from === 'SUBMITTED') {
    if (actorKindOf(actorId) === 'vendor') {
      if (to === 'CANCELLED') return
      throw new AppError(
        'INVALID_TRANSITION',
        `A submission cannot move from SUBMITTED to ${to}`,
        422,
      )
    }
    if (to === 'PAID') {
      if (ctx.categoryAfter == null) {
        throw new AppError('CATEGORY_REQUIRED', 'Set a category before approving', 422)
      }
      if (ctx.propertyIdAfter == null) {
        throw new AppError('PROPERTY_REQUIRED', 'Assign a property before approving', 422)
      }
      return
    }
    if (to === 'REJECTED') {
      if (!ctx.rejectionReason) {
        throw new AppError('REASON_REQUIRED', 'A rejection reason is required', 422)
      }
      return
    }
    throw new AppError(
      'INVALID_TRANSITION',
      `A submission can only be approved or rejected, not ${to}`,
      422,
    )
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
// `amount` is no longer direct user input (it's the server-computed sum of
// items) — its FIELD_EDITED tracking is handled separately in updateInvoice,
// alongside the items write, not through this generic loop.
const TRACKED_FIELDS = ['vendorName', 'invoiceDate'] as const

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
 * Next sequential invoice number **for one owner**, scanning that owner's max.
 * Runs on the transaction client, but that does not make the read-max +
 * insert race-free: Prisma's `$transaction` runs at the database default
 * (READ COMMITTED), so two concurrent transactions for the same tenant can
 * both read max N and both attempt N+1. Being in one transaction only makes
 * the *failure* clean — the loser blocks on the unique index and raises
 * P2002 rather than writing a duplicate — so a losing writer fails cleanly
 * instead of corrupting data; the handler's retry in a fresh transaction (see
 * `handlers.ts`) is what makes the sequence actually converge.
 *
 * Scoped by `userId`: numbers are unique per tenant, not globally
 * (`@@unique([userId, invoiceNumber])`). An unscoped scan would start a new
 * landlord's first invoice at the incumbent's max + 1, leaking their count.
 *
 * The max is computed by parsing in memory rather than a SQL `MAX()` because
 * the column is a string — `"9" > "10"` lexicographically.
 */
async function nextInvoiceNumber(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const rows = await tx.invoice.findMany({ where: { userId }, select: { invoiceNumber: true } })
  let max = 0
  for (const { invoiceNumber } of rows) {
    // invoiceNumber is nullable now (vendor submissions are unnumbered until
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

// A vendor has two namespaced strings, deliberately kept distinct (KTD-7/8):
// the ledger actor id (`vendor:<id>`) and the blob-prefix owner (`c_<id>`).
// Centralized here so the submit path, the vendor edit path, the public
// upload-token route, and the events resolver all derive them one way and never
// conflate them with each other or with the landlord owner id.
export const vendorActorId = (vendorId: string) => `vendor:${vendorId}`
// The blob path prefix stays `c_` deliberately: it is embedded in the storage
// keys of every image already uploaded. Renaming it would orphan them.
export const vendorBlobOwner = (vendorId: string) => `c_${vendorId}`

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
 * Resolve the vendor an invoice is attributed to, creating one when the
 * landlord typed a name they have no vendor for yet.
 *
 * Runs INSIDE the caller's transaction on purpose: a client-side
 * "create vendor, then create invoice" pair would leave an orphaned vendor
 * whenever the invoice write failed, and a double-submit would create two.
 *
 * An auto-created vendor gets no phone/email and is born with `revokedAt` set,
 * so it has no usable submission link until the landlord explicitly
 * regenerates one. The token columns are still populated because they are
 * NOT NULL and `tokenLookupId` is unique.
 */
export async function resolveVendorId(
  tx: Prisma.TransactionClient,
  landlordId: string,
  vendorId: string | undefined,
  vendorName: string | undefined,
): Promise<string | null> {
  if (vendorId != null) {
    // Scope to the landlord: 404 (not 403) so another landlord's vendor
    // existence never leaks — same rule as propertyId above.
    const owned = await tx.vendor.findFirst({ where: { id: vendorId, landlordId } })
    if (!owned) throw new AppError('NOT_FOUND', 'Vendor not found', 404)
    return owned.id
  }
  const name = vendorName?.trim()
  if (!name) return null

  const existing = await tx.vendor.findFirst({
    where: { landlordId, name: { equals: name, mode: 'insensitive' } },
  })
  if (existing) return existing.id

  // TOCTOU: two concurrent creates (e.g. a double-click) can both miss the
  // lookup above and both attempt to insert. The DB's case-insensitive
  // per-landlord unique index (migration 20260807200000) is the real guard —
  // the loser's insert throws P2002, which is not an error here but the
  // signal that a concurrent write won: re-read and return ITS row instead
  // of creating a duplicate. A P2002 with no matching row on re-read is
  // unexpected (not this race) — rethrow rather than looping.
  //
  // A failed statement aborts the rest of a Postgres transaction (any further
  // command 25P02s) until a ROLLBACK — including ROLLBACK TO SAVEPOINT — runs,
  // so the create is wrapped in a SAVEPOINT: on P2002 we roll back to it (not
  // the whole `tx`, which the caller still owns and needs to keep using) and
  // only then issue the re-read on the now-usable transaction.
  const savepoint = 'resolve_vendor_id_create'
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)
  try {
    const created = await tx.vendor.create({
      data: {
        landlordId,
        name,
        phone: null,
        email: null,
        revokedAt: new Date(),
        tokenLookupId: newLookupId(),
      },
    })
    return created.id
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    const winner = await tx.vendor.findFirst({
      where: { landlordId, name: { equals: name, mode: 'insensitive' } },
    })
    if (!winner) throw err
    return winner.id
  }
}

/**
 * Create an invoice and its CREATED event in one transaction. The invoice number
 * is the client-supplied one, or the next sequential number computed on `tx`. Any
 * supplied `images[]` (each owner-gated) are written as InvoiceImage rows +
 * IMAGE_ATTACHED events in the same transaction; 0 images is valid (create now,
 * photograph later). The legacy `attachmentUrl` is no longer written — `images[]`
 * is the single source of truth. Throws P2002 on a number collision — the handler
 * retries auto-numbered creates in a fresh transaction.
 */
export async function createInvoice(
  prisma: PrismaClient,
  actorId: string,
  input: CreateInvoiceInput,
) {
  const images = input.images ?? []
  for (const image of images) gateImageRef(image.url, actorId)
  return prisma.$transaction(async (tx) => {
    // A property assigned at create must belong to the acting landlord (404, not
    // 403, so another landlord's property existence never leaks).
    if (input.propertyId != null) {
      const owned = await tx.property.findFirst({
        where: { id: input.propertyId, landlordId: actorId },
      })
      if (!owned) throw new AppError('NOT_FOUND', 'Property not found', 404)
    }
    const resolvedVendorId = await resolveVendorId(tx, actorId, input.vendorId, input.vendorName)
    const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(tx, actorId))
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        vendorName: input.vendorName,
        vendorEmail: input.vendorEmail ?? null,
        vendorId: resolvedVendorId,
        amount: sumItemTotals(input.items),
        currency: input.currency,
        category: input.category,
        propertyId: input.propertyId ?? null,
        invoiceDate: input.invoiceDate,
        notes: input.notes ?? null,
        partsOrdered: input.partsOrdered ?? null,
        userId: actorId,
        items: { createMany: { data: nestedItemRows(input.items) } },
      },
      include: { user: userSelect, items: { orderBy: { sortOrder: 'asc' } } },
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
    for (const image of images) {
      await writeImageAttachment(tx, invoice.id, actorId, invoice.userId, image)
    }
    return invoice
  })
}

/**
 * Create a vendor submission: an invoice OWNED by the landlord but submitted
 * by (and attributed in the ledger to) the vendor. The three identities are
 * distinct (KTD-7/8): `ownerUserId` is the landlord (`user.connect` + the event's
 * ownerUserId), the event `actorId` is `vendor:<id>`, and the image gate uses
 * the vendor's blob prefix `c_<id>` (the uploader). The row lands SUBMITTED,
 * uncategorized, and unnumbered (a number is assigned on approval — KTD-11). At
 * least one photo is required (the proof) up to the cap; EACH is gated to the
 * vendor's own uploads — a single foreign URL rejects the whole submission.
 */
export async function createSubmission(
  prisma: PrismaClient,
  args: { ownerUserId: string; vendorId: string; vendorName: string },
  input: {
    items: InvoiceItemInput[]
    invoiceDate: Date
    notes?: string
    partsOrdered?: string
    category?: InvoiceCategory
    propertyId?: string
    images?: InvoiceImageInput[]
  },
) {
  const actorId = vendorActorId(args.vendorId)
  const blobOwner = vendorBlobOwner(args.vendorId)
  // Photos are optional on a submission (see SubmissionSchema); each supplied
  // one is still gated to the vendor's own uploads.
  const images = input.images ?? []
  for (const image of images) gateImageRef(image.url, blobOwner)
  return prisma.$transaction(async (tx) => {
    // A property named by the vendor must belong to the landlord who owns the
    // link AND be assigned to this vendor. Without the ownership half a token
    // could attach any property id it guessed and the invoice would show up
    // filed against another landlord's address; without the assignment half the
    // dropdown's narrowing would be cosmetic, since the vendor posts the id.
    if (input.propertyId != null) {
      const owned = await tx.property.findFirst({
        where: {
          id: input.propertyId,
          landlordId: args.ownerUserId,
          vendors: { some: { vendorId: args.vendorId } },
        },
      })
      if (!owned) throw new AppError('NOT_FOUND', 'Property not found', 404)
    }
    // The vendor form is itemized like the landlord's, so the amount is summed
    // from the lines here rather than trusted from the client — the same rule
    // createInvoice follows.
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: null,
        // The vendor never types their own name — it comes from the row their
        // link resolves to, so a submission is always attributed to the link
        // holder rather than to whatever they claimed to be.
        vendorName: args.vendorName,
        amount: sumItemTotals(input.items),
        category: input.category ?? null,
        ...(input.propertyId != null && { property: { connect: { id: input.propertyId } } }),
        invoiceDate: input.invoiceDate,
        notes: input.notes ?? null,
        partsOrdered: input.partsOrdered ?? null,
        status: 'SUBMITTED',
        user: { connect: { id: args.ownerUserId } },
        submittedByVendor: { connect: { id: args.vendorId } },
        vendor: { connect: { id: args.vendorId } },
        items: { createMany: { data: nestedItemRows(input.items) } },
      },
      include: { user: userSelect, items: { orderBy: { sortOrder: 'asc' } } },
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
    for (const image of images) {
      await writeImageAttachment(tx, invoice.id, actorId, invoice.userId, image)
    }
    return invoice
  })
}

/**
 * Vendor withdrawal of their OWN still-SUBMITTED submission (→ CANCELLED).
 * This is a distinct path from updateInvoice — NOT a parameterization of it —
 * because updateInvoice scopes ownership by `userId` (the landlord), which a
 * vendor never is. Scoping is by `submittedByVendorId`, and the write is a
 * compare-and-set: the `updateMany` re-asserts `status: 'SUBMITTED'`, so if the
 * landlord approved/rejected in the meantime the update matches zero rows and we
 * return a uniform 409 (landlord action wins the race). The same 409 covers
 * "not yours" and "doesn't exist", so a vendor can't probe other rows.
 *
 * Withdrawal is the ONLY vendor mutation of a filed submission — the PATCH edit
 * path was removed 2026-08-25 (submissions are read-only once filed; a vendor
 * who needs a change withdraws and resubmits).
 */
export async function withdrawSubmission(
  prisma: PrismaClient,
  args: { vendorId: string; invoiceId: string },
) {
  const actorId = vendorActorId(args.vendorId)
  const locked = () => new AppError('CONFLICT', 'This submission can no longer be changed', 409)
  return prisma.$transaction(async (tx) => {
    const scope = {
      id: args.invoiceId,
      submittedByVendorId: args.vendorId,
      status: 'SUBMITTED' as const,
    }
    const before = await tx.invoice.findFirst({ where: scope })
    if (!before) throw locked()

    // Compare-and-set: re-assert SUBMITTED so a concurrent landlord review wins.
    const result = await tx.invoice.updateMany({ where: scope, data: { status: 'CANCELLED' } })
    if (result.count === 0) throw locked()
    await tx.invoiceEvent.create({
      data: {
        invoiceId: args.invoiceId,
        actorId,
        ownerUserId: before.userId,
        type: 'STATUS_CHANGED',
        detail: { from: 'SUBMITTED', to: 'CANCELLED' },
      },
    })
    return tx.invoice.findFirstOrThrow({
      where: { id: args.invoiceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
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

    // A property assigned here must belong to the acting landlord. 404 (not 403)
    // so another landlord's property existence never leaks.
    if (input.propertyId != null) {
      const owned = await tx.property.findFirst({
        where: { id: input.propertyId, landlordId: actorId },
      })
      if (!owned) throw new AppError('NOT_FOUND', 'Property not found', 404)
    }

    const data: Prisma.InvoiceUncheckedUpdateInput = {}
    if (input.invoiceNumber !== undefined) data.invoiceNumber = input.invoiceNumber
    if (input.vendorName !== undefined) data.vendorName = input.vendorName
    if (input.vendorEmail !== undefined) data.vendorEmail = input.vendorEmail
    // items: full-replace when present (KTD) — the edit form always submits
    // the complete current list, not an incremental add/remove.
    if (input.items !== undefined) {
      data.amount = sumItemTotals(input.items)
    }
    if (input.currency !== undefined) data.currency = input.currency
    if (input.category !== undefined) data.category = input.category
    if (input.propertyId !== undefined) data.propertyId = input.propertyId
    if (input.invoiceDate !== undefined) data.invoiceDate = input.invoiceDate
    if (input.notes !== undefined) data.notes = input.notes
    if (input.partsOrdered !== undefined) data.partsOrdered = input.partsOrdered
    // Re-resolve only when the caller actually touched the vendor, so an
    // unrelated PATCH (a status change, say) never re-links the invoice.
    if (input.vendorId !== undefined || input.vendorName !== undefined) {
      data.vendorId = await resolveVendorId(
        tx,
        actorId,
        input.vendorId,
        input.vendorName ?? before.vendorName,
      )
    }

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
      // and approve in one call). Guard the transition before writing.
      const categoryAfter = input.category !== undefined ? input.category : before.category
      const propertyIdAfter = input.propertyId !== undefined ? input.propertyId : before.propertyId
      assertTransitionAllowed(actorId, before.status, next, {
        categoryAfter,
        propertyIdAfter,
        rejectionReason: input.rejectionReason,
      })
      data.status = next
      data.paidDate = next === 'PAID' ? (input.paidDate ?? new Date()) : null
      // Keep rejectionReason consistent with the status: set it on entering
      // REJECTED, clear any stale reason on every other transition.
      data.rejectionReason = next === 'REJECTED' ? (input.rejectionReason ?? null) : null
      // KTD-11: a vendor submission carries no number until it is approved —
      // so withdrawn/rejected submissions never leave gaps in the ledger. Assign
      // the next sequential number on the first transition into PAID (the
      // approve target now that APPROVED is gone).
      if (next === 'PAID' && before.invoiceNumber === null) {
        data.invoiceNumber = await nextInvoiceNumber(tx, actorId)
      }
      events.push({ ...base, type: 'STATUS_CHANGED', detail: { from: before.status, to: next } })
    }
    for (const field of TRACKED_FIELDS) {
      if (input[field] === undefined) continue
      const oldValue = normalize(field, (before as Record<string, unknown>)[field])
      const newValue = normalize(field, input[field])
      if (oldValue !== newValue) {
        events.push({
          ...base,
          type: 'FIELD_EDITED',
          detail: { field, old: oldValue, new: newValue },
        })
      }
    }
    // amount is server-computed from items, not direct input — diff it here
    // instead of through TRACKED_FIELDS so an item edit that changes the sum
    // still shows up in the timeline.
    if (data.amount !== undefined) {
      const oldValue = normalize('amount', before.amount)
      const newValue = normalize('amount', data.amount)
      if (oldValue !== newValue) {
        events.push({
          ...base,
          type: 'FIELD_EDITED',
          detail: { field: 'amount', old: oldValue, new: newValue },
        })
      }
    }

    // Ownership already verified via the scoped pre-read. When the status is
    // transitioning, re-assert the from-status in the write (compare-and-set) so
    // a concurrent transition (e.g. a vendor withdrawing the same instant
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
    // Full-replace the item list when provided (KTD).
    if (input.items !== undefined) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
      await tx.invoiceItem.createMany({ data: itemRows(id, input.items) })
    }
    if (events.length > 0) await tx.invoiceEvent.createMany({ data: events })

    return tx.invoice.findFirstOrThrow({
      where: { id },
      include: { user: userSelect, items: { orderBy: { sortOrder: 'asc' } } },
    })
  })
}

/**
 * Delete an own invoice. In one transaction, append a DELETED event carrying a
 * full snapshot of the final state (the ledger is the archive), then hard-remove
 * the row. The event's non-cascading `invoiceId` lets it outlive the invoice.
 */
export async function deleteInvoice(prisma: PrismaClient, actorId: string, id: string) {
  const imageUrls = await prisma.$transaction(async (tx) => {
    const before = await tx.invoice.findFirst({
      where: { id, userId: actorId },
      include: { images: true, items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!before) throw new AppError('NOT_FOUND', 'Invoice not found', 404)

    // Snapshot the scalar invoice, every image url, and every line item, so
    // the archive is complete even though the cascade drops all InvoiceImage
    // and InvoiceItem rows with the invoice — items now carry what used to
    // be the scalar `description` column, so omitting them would silently
    // lose the invoice's actual work description from history.
    const {
      images,
      items,
      user: _user,
      ...scalar
    } = before as Record<string, unknown> & {
      images: { url: string }[]
      items: {
        description: string
        quantity: number
        total: { toFixed: (n: number) => string }
        sortOrder: number
      }[]
    }
    const urls = images.map((img) => img.url)
    const itemSnapshots = items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      total: i.total.toFixed(2),
      sortOrder: i.sortOrder,
    }))
    await tx.invoiceEvent.create({
      data: {
        invoiceId: id,
        actorId,
        ownerUserId: before.userId,
        type: 'DELETED',
        detail: {
          snapshot: { ...serializeInvoice(scalar), imageUrls: urls, items: itemSnapshots },
        },
      },
    })
    await tx.invoice.deleteMany({ where: { id, userId: actorId } })
    return urls
  })
  // Reclaim every blob after the row is gone (best-effort — never fail the delete).
  for (const url of imageUrls) await deleteBlob(url).catch(() => {})
}

/**
 * Append one photo to an invoice's gallery. Gates the blob ref by owner (KTD-2b),
 * then in one transaction takes a row lock on the invoice (`SELECT … FOR UPDATE`),
 * counts existing rows, and throws IMAGE_LIMIT (422) at the cap (KTD-3) before
 * writing the row + an IMAGE_ATTACHED event. The lock serializes concurrent
 * appends on the same invoice: under Read Committed a bare count-then-insert is a
 * TOCTOU (two requests both read 4 and both insert → 6), so the parent-row lock
 * forces the second transaction to wait and re-count against the committed insert.
 */
export async function addImage(
  prisma: PrismaClient,
  actorId: string,
  invoiceId: string,
  image: InvoiceImageInput,
) {
  gateImageRef(image.url, actorId)
  await prisma.$transaction(async (tx) => {
    // Lock the invoice row (own-scoped) so concurrent appends serialize on it.
    // A non-owned/absent invoice locks nothing → 404 (no existence leak).
    const locked = await tx.$queryRaw<{ userId: string }[]>`
      SELECT "userId" FROM "invoices" WHERE id = ${invoiceId} AND "userId" = ${actorId} FOR UPDATE`
    if (locked.length === 0) throw new AppError('NOT_FOUND', 'Invoice not found', 404)
    const count = await tx.invoiceImage.count({ where: { invoiceId } })
    if (count >= MAX_INVOICE_IMAGES) {
      throw new AppError(
        'IMAGE_LIMIT',
        `An invoice can have at most ${MAX_INVOICE_IMAGES} photos`,
        422,
      )
    }
    await writeImageAttachment(tx, invoiceId, actorId, locked[0].userId, image)
  })
}

/**
 * Remove one photo by id: delete the row + blob and emit IMAGE_REMOVED. The image
 * is resolved with a SINGLE ownership-joined query (KTD-2a) so a landlord can't
 * delete another invoice's image by guessing an id — a non-owned/foreign id 404s.
 */
export async function removeImage(
  prisma: PrismaClient,
  actorId: string,
  invoiceId: string,
  imageId: string,
) {
  const removedUrl = await prisma.$transaction(async (tx) => {
    const image = await tx.invoiceImage.findFirst({
      where: { id: imageId, invoiceId, invoice: { userId: actorId } },
    })
    if (!image) throw new AppError('NOT_FOUND', 'Photo not found', 404)
    await tx.invoiceImage.delete({ where: { id: imageId } })
    await tx.invoiceEvent.create({
      data: {
        invoiceId,
        actorId,
        ownerUserId: actorId,
        type: 'IMAGE_REMOVED',
        detail: { url: image.url },
      },
    })
    return image.url
  })
  await deleteBlob(removedUrl).catch(() => {})
}

/**
 * Change one photo's type (landlord gallery, KTD-5). Resolved with the same
 * single ownership-joined query as removeImage (KTD-2a) — a non-owned/foreign
 * imageId 404s. No event (a type retag is not a financially-material change).
 */
export async function setImageType(
  prisma: PrismaClient,
  actorId: string,
  invoiceId: string,
  imageId: string,
  type: InvoiceImageInput['type'],
) {
  const image = await prisma.invoiceImage.findFirst({
    where: { id: imageId, invoiceId, invoice: { userId: actorId } },
  })
  if (!image) throw new AppError('NOT_FOUND', 'Photo not found', 404)
  await prisma.invoiceImage.update({ where: { id: imageId }, data: { type } })
}
