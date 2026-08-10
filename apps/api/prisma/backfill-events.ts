import { pathToFileURL } from 'node:url'
import { prisma as defaultPrisma } from '../src/lib/prisma'
import type { Prisma } from './generated/client.ts'

// One-time backfill: give invoices created before the ledger a reconstructed
// timeline so the detail view isn't blank for them. Derives a CREATED event
// (dated createdAt) plus, where a paidDate exists, a STATUS_CHANGED {to:'PAID'}
// (dated paidDate). All flagged source='RECONSTRUCTED' so the UI can label them
// as inferred. Idempotent: invoices that already have any event are skipped.
//
// Run once with `npm run db:backfill-events` — it is NOT a Prisma migration and
// does not run on `prisma migrate deploy`.

type Db = Pick<typeof defaultPrisma, 'invoice' | 'invoiceEvent'>

export async function backfillEvents(prisma: Db = defaultPrisma) {
  const invoices = await prisma.invoice.findMany({
    select: { id: true, userId: true, createdAt: true, paidDate: true },
  })
  const withEvents = await prisma.invoiceEvent.findMany({
    select: { invoiceId: true },
    distinct: ['invoiceId'],
  })
  const alreadyHasEvents = new Set(withEvents.map((e) => e.invoiceId))

  const rows: Prisma.InvoiceEventCreateManyInput[] = []
  let invoicesBackfilled = 0
  for (const inv of invoices) {
    if (alreadyHasEvents.has(inv.id)) continue
    invoicesBackfilled++
    const base = {
      invoiceId: inv.id,
      actorId: inv.userId,
      ownerUserId: inv.userId,
      source: 'RECONSTRUCTED' as const,
    }
    rows.push({ ...base, type: 'CREATED', detail: {}, createdAt: inv.createdAt })
    if (inv.paidDate) {
      rows.push({
        ...base,
        type: 'STATUS_CHANGED',
        detail: { to: 'PAID' },
        createdAt: inv.paidDate,
      })
    }
  }
  if (rows.length) await prisma.invoiceEvent.createMany({ data: rows })
  return { invoicesBackfilled, eventsCreated: rows.length }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  backfillEvents()
    .then(async (r) => {
      console.log(`Backfilled ${r.invoicesBackfilled} invoice(s) → ${r.eventsCreated} event(s).`)
      await defaultPrisma.$disconnect()
    })
    .catch(async (err) => {
      console.error(err)
      await defaultPrisma.$disconnect()
      process.exit(1)
    })
}
