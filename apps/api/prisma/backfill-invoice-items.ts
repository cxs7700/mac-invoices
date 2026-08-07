import { pathToFileURL } from 'node:url'
import { prisma as defaultPrisma } from '../src/lib/prisma'

// One-time backfill for the itemized-invoice migration (add_invoice_items_and_
// user_names). Two independent passes, both idempotent:
//
// 1. Every invoice with zero InvoiceItem rows gets exactly one: description =
//    its current `description`, quantity 1, total = its current `amount` —
//    matching the confirmed "existing invoices become one line item" rule.
// 2. Every user with firstName AND lastName both null gets them split from
//    their existing `name` on the first space (a one-word name → firstName
//    only, lastName stays null; a null/empty name → both stay null).
//
// Run once with `npm run db:backfill-invoice-items` — it is NOT a Prisma
// migration and does not run on `prisma migrate deploy`.

type Db = Pick<typeof defaultPrisma, 'invoice' | 'invoiceItem' | 'user'>

async function backfillItems(prisma: Db) {
  const invoices = await prisma.invoice.findMany({
    select: { id: true, description: true, amount: true },
  })
  const withItems = await prisma.invoiceItem.findMany({
    select: { invoiceId: true },
    distinct: ['invoiceId'],
  })
  const alreadyHasItems = new Set(withItems.map((i) => i.invoiceId))

  let invoicesBackfilled = 0
  for (const inv of invoices) {
    if (alreadyHasItems.has(inv.id)) continue
    invoicesBackfilled++
    await prisma.invoiceItem.create({
      data: {
        invoiceId: inv.id,
        description: inv.description,
        quantity: 1,
        total: inv.amount,
        sortOrder: 0,
      },
    })
  }
  return invoicesBackfilled
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  const trimmed = name?.trim()
  if (!trimmed) return { firstName: null, lastName: null }
  const spaceIndex = trimmed.indexOf(' ')
  if (spaceIndex === -1) return { firstName: trimmed, lastName: null }
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1).trim() }
}

async function backfillNames(prisma: Db) {
  const users = await prisma.user.findMany({
    where: { firstName: null, lastName: null },
    select: { id: true, name: true },
  })
  for (const user of users) {
    const { firstName, lastName } = splitName(user.name)
    if (firstName === null && lastName === null) continue
    await prisma.user.update({ where: { id: user.id }, data: { firstName, lastName } })
  }
  return users.length
}

export async function backfillInvoiceItems(prisma: Db = defaultPrisma) {
  const invoicesBackfilled = await backfillItems(prisma)
  const usersBackfilled = await backfillNames(prisma)
  return { invoicesBackfilled, usersBackfilled }
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  backfillInvoiceItems()
    .then(async (r) => {
      console.log(
        `Backfilled ${r.invoicesBackfilled} invoice(s) with an item; split names for ${r.usersBackfilled} user(s).`,
      )
      await defaultPrisma.$disconnect()
    })
    .catch(async (err) => {
      console.error(err)
      await defaultPrisma.$disconnect()
      process.exit(1)
    })
}
