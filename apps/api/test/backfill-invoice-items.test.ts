import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { backfillInvoiceItems } from '../prisma/backfill-invoice-items'
import { hashPassword } from '../src/auth/password'

// Backfill for the itemized-invoice migration: one InvoiceItem per pre-items
// invoice, and firstName/lastName split from `name` for pre-split users. The
// function is global by design (the operator runs it once); these tests
// assert its behavior on controlled rows, cleaning up in afterAll.
const app = buildApp()
const PREFIX = 'TEST-ITEMS-BACKFILL-'

let landlordId: string

async function invoiceWithoutItems(n: string, over: Record<string, unknown> = {}) {
  return app.prisma.invoice.create({
    data: {
      invoiceNumber: `${PREFIX}${n}`,
      vendorName: 'Vendor',
      description: 'Fixed a leak',
      amount: 149.99,
      category: 'OTHER',
      invoiceDate: new Date('2026-01-01T00:00:00.000Z'),
      userId: landlordId,
      ...over,
    },
  })
}

async function userWithName(name: string | null) {
  const email = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  return app.prisma.user.create({
    data: { email, name, role: 'LANDLORD', passwordHash: await hashPassword('unused-pass') },
  })
}

beforeAll(async () => {
  await app.ready()
  const landlord = await app.prisma.user.findFirst({ where: { role: 'LANDLORD' } })
  landlordId = landlord!.id
})
afterAll(async () => {
  await app.prisma.invoiceItem.deleteMany({
    where: { invoice: { invoiceNumber: { startsWith: PREFIX } } },
  })
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await app.prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
  await app.close()
})

describe('backfillInvoiceItems', () => {
  it('gives every item-less invoice exactly one item matching its description/amount, and is idempotent', async () => {
    const inv = await invoiceWithoutItems('one')

    const first = await backfillInvoiceItems(app.prisma)
    expect(first.invoicesBackfilled).toBeGreaterThanOrEqual(1)

    const items = await app.prisma.invoiceItem.findMany({ where: { invoiceId: inv.id } })
    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('Fixed a leak')
    expect(items[0].quantity).toBe(1)
    expect(items[0].total.toString()).toBe('149.99')
    expect(items[0].sortOrder).toBe(0)

    // Re-running does not duplicate the item for an already-backfilled invoice.
    const second = await backfillInvoiceItems(app.prisma)
    const itemsAfter = await app.prisma.invoiceItem.findMany({ where: { invoiceId: inv.id } })
    expect(itemsAfter).toHaveLength(1)
    void second
  })

  it('leaves an invoice that already has items untouched', async () => {
    const inv = await invoiceWithoutItems('has-items')
    await app.prisma.invoiceItem.create({
      data: { invoiceId: inv.id, description: 'Custom line', quantity: 2, total: 40, sortOrder: 0 },
    })

    await backfillInvoiceItems(app.prisma)

    const items = await app.prisma.invoiceItem.findMany({ where: { invoiceId: inv.id } })
    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('Custom line')
  })

  it('splits a two-word name into firstName/lastName', async () => {
    const user = await userWithName('Jane Doe')
    await backfillInvoiceItems(app.prisma)
    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.firstName).toBe('Jane')
    expect(updated.lastName).toBe('Doe')
  })

  it('a one-word name backfills to firstName only, lastName stays null', async () => {
    const user = await userWithName('Cher')
    await backfillInvoiceItems(app.prisma)
    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.firstName).toBe('Cher')
    expect(updated.lastName).toBeNull()
  })

  it('a null name backfills to both fields null', async () => {
    const user = await userWithName(null)
    await backfillInvoiceItems(app.prisma)
    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.firstName).toBeNull()
    expect(updated.lastName).toBeNull()
  })

  it('does not re-split a user who already has names set', async () => {
    const user = await userWithName('Multi Word Name')
    await backfillInvoiceItems(app.prisma)
    // Manually change firstName to prove a second run leaves it alone.
    await app.prisma.user.update({ where: { id: user.id }, data: { firstName: 'Edited' } })
    await backfillInvoiceItems(app.prisma)
    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.firstName).toBe('Edited')
  })
})
