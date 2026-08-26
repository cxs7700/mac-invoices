import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PrismaClient, EventType } from '../../prisma/generated/client.ts'

// The landlord's in-app notification feed. Reads vendor-authored events from
// the InvoiceEvent ledger (the same source the email digest uses) scoped to the
// landlord (ownerUserId), newest first. Unlike the email digest, the feed ALSO
// surfaces edits (FIELD_EDITED) and withdrawals — activity the SUBMITTED queue
// alone doesn't show. Unread = an event newer than the landlord's
// `notificationsSeenAt` marker.

// Must stay in lockstep with vendorActorId() in invoices/writeService.ts and with
// the stored value — the rename migration rewrote historical rows to this prefix.
const VENDOR = 'vendor:'
const FEED_LIMIT = 50

type FeedRow = {
  id: string
  invoiceId: string
  actorId: string
  type: string
  detail: unknown
  createdAt: Date
}

/**
 * Where-clause for this landlord's vendor-authored events. IMAGE_ATTACHED /
 * IMAGE_REMOVED are excluded: a submission writes one IMAGE_ATTACHED per photo
 * in the same transaction as its CREATED event, so surfacing them turns one
 * submission into N+1 notifications.
 */
function feedWhere(ownerUserId: string) {
  return {
    ownerUserId,
    actorId: { startsWith: VENDOR },
    type: { notIn: ['IMAGE_ATTACHED', 'IMAGE_REMOVED'] as EventType[] },
  }
}

/** Human-readable one-liner for a vendor event (no vendor name embedded). */
function summarize(e: FeedRow): string {
  if (e.type === 'CREATED') return 'submitted an invoice'
  if (e.type === 'FIELD_EDITED') return 'edited a submission'
  if (e.type === 'STATUS_CHANGED') {
    const to = (e.detail as { to?: string } | null)?.to
    if (to === 'CANCELLED') return 'withdrew a submission'
    return 'updated a submission'
  }
  return 'updated a submission'
}

export async function listFeed(request: FastifyRequest, reply: FastifyReply) {
  const prisma = request.server.prisma as PrismaClient
  const ownerUserId = request.user.id

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: ownerUserId },
    select: { notificationsSeenAt: true },
  })
  const seenAt = me.notificationsSeenAt

  const rows = (await prisma.invoiceEvent.findMany({
    where: feedWhere(ownerUserId),
    select: { id: true, invoiceId: true, actorId: true, type: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: FEED_LIMIT,
  })) as FeedRow[]

  // Resolve vendor names, scoped to this landlord (no cross-owner name leak).
  const vendorIds = [...new Set(rows.map((e) => e.actorId.slice(VENDOR.length)))]
  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds }, landlordId: ownerUserId },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(vendors.map((v) => [v.id, v.name]))

  const data = rows.map((e) => ({
    id: e.id,
    type: e.type,
    vendorName: nameById.get(e.actorId.slice(VENDOR.length)) ?? null,
    invoiceId: e.invoiceId,
    summary: summarize(e),
    createdAt: e.createdAt,
    unread: seenAt === null || e.createdAt > seenAt,
  }))

  // True unread count (not window-bounded): events strictly newer than the marker.
  const unreadCount = await prisma.invoiceEvent.count({
    where: { ...feedWhere(ownerUserId), ...(seenAt ? { createdAt: { gt: seenAt } } : {}) },
  })

  return reply.send({ data, unreadCount })
}

/** Mark the feed read up to now: stamp the landlord's `notificationsSeenAt`. */
export async function markSeen(request: FastifyRequest, reply: FastifyReply) {
  const prisma = request.server.prisma as PrismaClient
  await prisma.user.update({
    where: { id: request.user.id },
    data: { notificationsSeenAt: new Date() },
  })
  return reply.send({ ok: true })
}
