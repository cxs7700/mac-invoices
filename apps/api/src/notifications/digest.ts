import type { PrismaClient } from '../../prisma/generated/client.ts'
import { sendEmail } from '../integrations/email'

// The landlord digest flush. Reads un-notified, email-eligible vendor events
// from the InvoiceEvent ledger (no new write-path instrumentation), groups by
// landlord, and for each landlord SENDS the digest THEN stamps the events
// `notifiedAt` — a death between the two re-sends next run (at-least-once; a
// duplicate digest beats a dropped one). Each landlord is its own commit
// boundary: one provider failure leaves that landlord's events un-notified and
// does not crash the job or block other landlords.

// Must stay in lockstep with vendorActorId() in invoices/writeService.ts and with
// the stored value — the rename migration rewrote historical rows to this prefix.
const VENDOR = 'vendor:'

/** Escape a value before interpolating it into the digest email HTML. Vendor
 * names are landlord-authored today, but escaping keeps the email a safe sink if
 * a vendor-controlled naming flow is ever added (defense in depth). */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

type Eligible = {
  id: string
  ownerUserId: string
  actorId: string
  type: string
  detail: unknown
}

/** A vendor-authored event is email-eligible if it's a submission (CREATED)
 * or a withdrawal (STATUS_CHANGED → CANCELLED). Edits (FIELD_EDITED) are not. */
function isWithdrawal(e: Eligible): boolean {
  return e.type === 'STATUS_CHANGED' && (e.detail as { to?: string } | null)?.to === 'CANCELLED'
}

export type FlushSummary = { landlords: number; events: number; sent: number; failed: number }

export async function runDigestFlush(prisma: PrismaClient): Promise<FlushSummary> {
  const events = (await prisma.invoiceEvent.findMany({
    where: {
      notifiedAt: null,
      actorId: { startsWith: VENDOR },
      type: { in: ['CREATED', 'STATUS_CHANGED'] },
    },
    select: { id: true, ownerUserId: true, actorId: true, type: true, detail: true },
    orderBy: [{ ownerUserId: 'asc' }, { createdAt: 'asc' }],
  })) as Eligible[]

  // Keep submissions and withdrawals; drop any non-withdrawal STATUS_CHANGED.
  const eligible = events.filter((e) => e.type === 'CREATED' || isWithdrawal(e))
  if (eligible.length === 0) return { landlords: 0, events: 0, sent: 0, failed: 0 }

  // Group by landlord (ownerUserId).
  const byLandlord = new Map<string, Eligible[]>()
  for (const e of eligible) {
    const list = byLandlord.get(e.ownerUserId) ?? []
    list.push(e)
    byLandlord.set(e.ownerUserId, list)
  }

  const landlords = await prisma.user.findMany({
    where: { id: { in: [...byLandlord.keys()] } },
    select: { id: true, email: true },
  })
  const emailById = new Map(landlords.map((u) => [u.id, u.email]))

  let sent = 0
  let failed = 0
  for (const [landlordId, group] of byLandlord) {
    const email = emailById.get(landlordId)
    if (!email) continue
    try {
      const { subject, html } = await buildDigest(prisma, landlordId, group)
      await sendEmail({ to: email, subject, html }) // SEND first…
      await prisma.invoiceEvent.updateMany({
        where: { id: { in: group.map((e) => e.id) }, notifiedAt: null },
        data: { notifiedAt: new Date() }, // …THEN stamp (at-least-once on failure between).
      })
      sent++
    } catch {
      // One landlord's provider failure must not crash the job or block others;
      // its events stay un-notified and are retried next run.
      failed++
    }
  }
  return { landlords: byLandlord.size, events: eligible.length, sent, failed }
}

/** Build a landlord's digest (vendor names resolved, scoped to that landlord). */
async function buildDigest(prisma: PrismaClient, landlordId: string, group: Eligible[]) {
  const vendorIds = [...new Set(group.map((e) => e.actorId.slice(VENDOR.length)))]
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds }, landlordId }, // landlord-scoped: no cross-owner name leak
    select: { id: true, name: true },
  })
  const nameById = new Map(vendors.map((v) => [v.id, v.name]))
  const nameOf = (e: Eligible) =>
    escapeHtml(nameById.get(e.actorId.slice(VENDOR.length)) ?? 'A vendor')

  const submissions = group.filter((e) => e.type === 'CREATED')
  const withdrawals = group.filter(isWithdrawal)
  const base = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
  const reviewUrl = `${base}/invoices?status=SUBMITTED`

  const parts: string[] = []
  if (submissions.length) parts.push(`${submissions.length} new submission${submissions.length > 1 ? 's' : ''}`)
  if (withdrawals.length) parts.push(`${withdrawals.length} withdrawal${withdrawals.length > 1 ? 's' : ''}`)
  const subject = `Mac Invoices — ${parts.join(' and ')}`

  const lines = [
    ...submissions.map((e) => `<li>${nameOf(e)} submitted an invoice</li>`),
    ...withdrawals.map((e) => `<li>${nameOf(e)} withdrew a submission</li>`),
  ].join('')
  const html =
    `<p>Vendor activity awaiting your review:</p><ul>${lines}</ul>` +
    `<p><a href="${reviewUrl}">Review submissions</a></p>`

  return { subject, html }
}
