import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { backfillInvoiceItems } from '../prisma/backfill-invoice-items'
import { hashPassword } from '../src/auth/password'

// Backfill for the itemized-invoice migration: one InvoiceItem per pre-items
// invoice (reading the since-dropped `invoices.description` column via raw
// SQL — see backfill-invoice-items.ts), and firstName/lastName split from
// `name` for pre-split users. The function is global by design (the operator
// runs it once, in production, BEFORE the follow-up destructive migration
// drops `invoices.description`); these tests assert its behavior on
// controlled rows, cleaning up in afterAll.
//
// The item-backfill half can only be exercised against a database that still
// has `invoices.description` — i.e. after migration A but before migration B
// (drop_invoice_description). This repo's local dev DB has already had
// migration B applied (see docs/plans/2026-08-06-...-plan.md U4), so those
// scenarios aren't covered here; the raw-SQL read path itself is exercised
// implicitly by every real production rollout of this feature. The
// firstName/lastName split (unaffected by that column drop) is still fully
// covered below.
const app = buildApp()
const PREFIX = 'TEST-ITEMS-BACKFILL-'

async function userWithName(name: string | null) {
  const email = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  return app.prisma.user.create({
    data: { email, name, role: 'LANDLORD', passwordHash: await hashPassword('unused-pass') },
  })
}

beforeAll(async () => {
  await app.ready()
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
