import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'
import { backfillEvents } from '../prisma/backfill-events'

// Backfill (U7): reconstruct a timeline for pre-ledger invoices. The function is
// global by design (the operator runs it once); these tests assert its behavior
// on controlled pre-ledger rows, then clear all RECONSTRUCTED events in afterAll
// to restore the shared DB.
const app = buildApp()
const PREFIX = 'TEST-BACKFILL-'
let cookie: string
let user: Awaited<ReturnType<typeof createSecondUser>>

const createdAt = new Date('2026-01-01T00:00:00.000Z')
const paidDate = new Date('2026-03-01T00:00:00.000Z')

async function preLedgerInvoice(n: string, over: Record<string, unknown> = {}) {
  // Direct create — bypasses the write-service, so NO event (simulates a row
  // that predates the ledger).
  return app.prisma.invoice.create({
    data: {
      invoiceNumber: `${PREFIX}${n}`,
      vendorName: 'Vendor',
      amount: 100,
      category: 'OTHER',
      invoiceDate: createdAt,
      createdAt,
      userId: user.user.id,
      ...over,
    },
  })
}

const eventsFor = (invoiceId: string) =>
  app.prisma.invoiceEvent.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } })

beforeAll(async () => {
  await app.ready()
  cookie = await loginCookie(app)
  user = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoiceEvent.deleteMany({ where: { source: 'RECONSTRUCTED' } })
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } })
  await user.cleanup()
  await app.close()
})

describe('backfillEvents', () => {
  it('reconstructs CREATED (+ paid STATUS_CHANGED) for pre-ledger invoices, and is idempotent', async () => {
    const paid = await preLedgerInvoice('paid', { status: 'PAID', paidDate })
    const pending = await preLedgerInvoice('pending')
    // A post-ledger invoice already carries a RECORDED CREATED event.
    const apiCreated = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        invoiceNumber: `${PREFIX}api`,
        vendorName: 'Vendor',
        items: [{ description: 'Work', quantity: 1, total: 100 }],
        category: 'OTHER',
        invoiceDate: '2026-02-01',
      },
      headers: { cookie },
    })
    const apiId = apiCreated.json().id

    await backfillEvents(app.prisma)

    // Paid pre-ledger invoice → reconstructed CREATED (at createdAt) + paid event.
    const paidEvents = await eventsFor(paid.id)
    expect(paidEvents.map((e) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED'])
    expect(paidEvents.every((e) => e.source === 'RECONSTRUCTED')).toBe(true)
    expect(paidEvents[0].createdAt.toISOString()).toBe(createdAt.toISOString())
    expect(paidEvents[1].detail).toEqual({ to: 'PAID' })
    expect(paidEvents[1].createdAt.toISOString()).toBe(paidDate.toISOString())

    // Pending pre-ledger invoice → just a reconstructed CREATED.
    const pendingEvents = await eventsFor(pending.id)
    expect(pendingEvents.map((e) => e.type)).toEqual(['CREATED'])
    expect(pendingEvents[0].source).toBe('RECONSTRUCTED')

    // Post-ledger invoice is untouched (still exactly its RECORDED CREATED).
    const apiEvents = await eventsFor(apiId)
    expect(apiEvents).toHaveLength(1)
    expect(apiEvents[0].source).toBe('RECORDED')

    // Idempotent: a second run adds nothing.
    await backfillEvents(app.prisma)
    expect(await eventsFor(paid.id)).toHaveLength(2)
    expect(await eventsFor(pending.id)).toHaveLength(1)
    expect(await eventsFor(apiId)).toHaveLength(1)
  })
})
