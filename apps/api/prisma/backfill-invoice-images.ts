import { pathToFileURL } from 'node:url'
import { prisma as defaultPrisma } from '../src/lib/prisma'

// One-time backfill: fold every legacy `Invoice.attachmentUrl` into the
// `images[]` collection (the new single source of truth) so the gallery, the
// "has photos?" check, and the add-photo indicator all read one place. Each
// matching invoice gets one InvoiceImage row (type OTHER); the image id is an
// app-level cuid, so this is a Prisma script (the client fills the cuid) — NOT
// raw SQL (Postgres has no cuid generator). Idempotent: invoices that already
// have any image row are skipped, so re-running inserts nothing.
//
// Run once with `npm run db:backfill-images` — it is NOT a Prisma migration and
// does not run on `prisma migrate deploy`. The `attachmentUrl` column is retained
// (unused) and no longer written by any path.

type Db = Pick<typeof defaultPrisma, 'invoice' | 'invoiceImage'>

export async function backfillInvoiceImages(prisma: Db = defaultPrisma) {
  const candidates = await prisma.invoice.findMany({
    where: { attachmentUrl: { not: null } },
    select: { id: true, attachmentUrl: true },
  })
  const withImages = await prisma.invoiceImage.findMany({
    select: { invoiceId: true },
    distinct: ['invoiceId'],
  })
  const alreadyHasImages = new Set(withImages.map((i) => i.invoiceId))

  let imagesCreated = 0
  for (const inv of candidates) {
    if (alreadyHasImages.has(inv.id) || !inv.attachmentUrl) continue
    await prisma.invoiceImage.create({
      data: { invoiceId: inv.id, url: inv.attachmentUrl, type: 'OTHER' },
    })
    imagesCreated++
  }
  return { candidates: candidates.length, imagesCreated }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  backfillInvoiceImages()
    .then(async (r) => {
      console.log(`Backfilled ${r.imagesCreated} image(s) from ${r.candidates} legacy attachment(s).`)
      await defaultPrisma.$disconnect()
    })
    .catch(async (err) => {
      console.error(err)
      await defaultPrisma.$disconnect()
      process.exit(1)
    })
}
