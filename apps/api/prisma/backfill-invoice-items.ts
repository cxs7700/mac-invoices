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

type Db = Pick<typeof defaultPrisma, 'invoiceItem' | 'user' | '$queryRaw'>

// Reads `description`/`amount` via raw SQL, not the typed Prisma client: the
// follow-up destructive migration drops `invoices.description` from the
// schema (and the generated types) once this backfill has run, but this
// script must keep working against a production DB that still physically
// has the column at the moment it's invoked — a typed `findMany` would stop
// compiling the instant the schema is updated, even though the column is
// still there until migration B actually runs.
//
// Idempotent beyond that window too: if `invoices.description` has already
// been dropped (migration B already ran — this DB has nothing left to
// backfill from), skip this pass instead of erroring, so a stray re-run of
// the whole script doesn't crash the still-useful name-split pass.
async function backfillItems(prisma: Db) {
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'invoices' AND column_name = 'description'
    ) AS exists`
  if (!exists) return 0

  const invoices = await prisma.$queryRaw<{ id: string; description: string; amount: string }[]>`
    SELECT i.id, i.description, i.amount::text AS amount
    FROM invoices i
    WHERE NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii."invoiceId" = i.id)`

  for (const inv of invoices) {
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
  return invoices.length
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
