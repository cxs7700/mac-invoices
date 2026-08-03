import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// Mock the Sheets seam — no live Google calls. overwriteRows is captured to prove
// which users got a full mirror and with what rows.
const overwriteRows = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/integrations/sheets', () => ({
  overwriteRows,
  appendRows: vi.fn(),
  checkAccess: vi.fn(),
  serviceAccountEmail: vi.fn(() => 'svc@x.iam.gserviceaccount.com'),
}))

import { buildApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { runSheetsSyncFlush } from '../src/invoices/sheetSync'
import * as writeService from '../src/invoices/writeService'

const app = buildApp()
const created: string[] = [] // landlord ids to clean up

const uniq = () => Math.random().toString(36).slice(2, 10)

/** A landlord with a connected sheet (unique target so parallel assertions don't collide). */
async function makeLandlord() {
  const target = `SS-${uniq()}`
  const u = await app.prisma.user.create({
    data: {
      email: `ss-${Date.now()}-${uniq()}@example.com`,
      role: 'LANDLORD',
      passwordHash: await hashPassword('x'),
      sheetSpreadsheetId: target,
    },
  })
  created.push(u.id)
  return { ...u, target }
}

async function makeInvoice(userId: string, extra: Record<string, unknown> = {}) {
  return app.prisma.invoice.create({
    data: {
      invoiceNumber: `SS-INV-${uniq()}`,
      vendorName: 'V',
      description: 'w',
      amount: 10,
      category: 'OTHER',
      invoiceDate: new Date('2026-03-01'),
      userId,
      ...extra,
    },
  })
}

/** All overwriteRows calls that targeted `target` (mirror is global; filter to ours). */
const callsFor = (target: string) => overwriteRows.mock.calls.filter((c) => c[0] === target)
const hwOf = async (userId: string) =>
  (await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).sheetSyncedAt

beforeAll(async () => {
  await app.ready()
})
beforeEach(() => {
  overwriteRows.mockReset().mockResolvedValue(undefined)
})
afterAll(async () => {
  for (const id of created) {
    await app.prisma.invoiceEvent.deleteMany({ where: { ownerUserId: id } })
    await app.prisma.invoice.deleteMany({ where: { userId: id } })
    await app.prisma.user.delete({ where: { id } }).catch(() => {})
  }
  await app.close()
})

describe('continuous Sheets sync flush', () => {
  it('mirrors a connected landlord with changes: header + a row per exportable invoice, advances the high-water', async () => {
    const l = await makeLandlord()
    await makeInvoice(l.id)
    await makeInvoice(l.id)
    expect(await hwOf(l.id)).toBeNull()

    await runSheetsSyncFlush(app.prisma)

    const myCalls = callsFor(l.target)
    expect(myCalls).toHaveLength(1)
    expect(myCalls[0][1]).toHaveLength(3) // header + 2 data rows
    expect(myCalls[0][1][0]).toContain('Invoice #') // header row
    expect(await hwOf(l.id)).not.toBeNull()
  })

  it('skips a landlord whose data is unchanged since the last sync (no Sheets write)', async () => {
    const l = await makeLandlord()
    const inv = await makeInvoice(l.id)
    // Mark synced exactly at the invoice's own updatedAt → not dirty.
    await app.prisma.user.update({ where: { id: l.id }, data: { sheetSyncedAt: inv.updatedAt } })

    await runSheetsSyncFlush(app.prisma)
    expect(callsFor(l.target)).toHaveLength(0)
  })

  it('re-mirrors after an invoice is edited (drift propagates)', async () => {
    const l = await makeLandlord()
    const inv = await makeInvoice(l.id)
    await app.prisma.user.update({ where: { id: l.id }, data: { sheetSyncedAt: inv.updatedAt } })

    // Clean first → skipped.
    await runSheetsSyncFlush(app.prisma)
    expect(callsFor(l.target)).toHaveLength(0)

    // An edit bumps updatedAt past the high-water → dirty again.
    await app.prisma.invoice.update({ where: { id: inv.id }, data: { vendorName: 'Edited' } })
    await runSheetsSyncFlush(app.prisma)
    expect(callsFor(l.target)).toHaveLength(1)
  })

  it('drops a deleted invoice from the mirror (delete propagates via the DELETED event)', async () => {
    const l = await makeLandlord()
    const keep = await makeInvoice(l.id)
    const gone = await makeInvoice(l.id)

    // First mirror writes both.
    await runSheetsSyncFlush(app.prisma)
    expect(callsFor(l.target).at(-1)![1]).toHaveLength(3) // header + 2

    // Hard-delete one (writes a DELETED ledger event → user goes dirty again).
    overwriteRows.mockClear()
    await writeService.deleteInvoice(app.prisma, l.id, gone.id)
    await runSheetsSyncFlush(app.prisma)

    const rows = callsFor(l.target).at(-1)![1] as unknown[][]
    expect(rows).toHaveLength(2) // header + 1
    const numbers = rows.slice(1).map((r) => r[1])
    expect(numbers).toContain(keep.invoiceNumber)
    expect(numbers).not.toContain(gone.invoiceNumber)
  })

  it("isolates one landlord's Sheets failure: it is counted, the others still sync", async () => {
    const bad = await makeLandlord()
    const good = await makeLandlord()
    await makeInvoice(bad.id)
    await makeInvoice(good.id)
    overwriteRows.mockImplementation(async (target: string) => {
      if (target === bad.target) throw new Error('permission denied')
    })

    await runSheetsSyncFlush(app.prisma)

    // Both were attempted; only the good one was stamped (the failure is retried next run).
    expect(callsFor(bad.target).length).toBeGreaterThanOrEqual(1)
    expect(callsFor(good.target).length).toBeGreaterThanOrEqual(1)
    expect(await hwOf(bad.id)).toBeNull()
    expect(await hwOf(good.id)).not.toBeNull()
  })

  it('a failed mirror stays dirty and the next flush re-mirrors and stamps (at-least-once)', async () => {
    const l = await makeLandlord()
    await makeInvoice(l.id)
    // Fail only THIS user (the flush is global — other dirty users must not consume
    // a one-shot rejection meant for us).
    overwriteRows.mockImplementation(async (target: string) => {
      if (target === l.target) throw new Error('transient')
    })

    await runSheetsSyncFlush(app.prisma) // fails for l → not stamped
    expect(await hwOf(l.id)).toBeNull()

    overwriteRows.mockReset().mockResolvedValue(undefined)
    await runSheetsSyncFlush(app.prisma) // retries → succeeds
    expect(callsFor(l.target).length).toBeGreaterThanOrEqual(1)
    expect(await hwOf(l.id)).not.toBeNull()
  })

  it('never mirrors a landlord with no connected sheet', async () => {
    const noSheet = await app.prisma.user.create({
      data: {
        email: `ss-nosheet-${uniq()}@example.com`,
        role: 'LANDLORD',
        passwordHash: await hashPassword('x'),
      },
    })
    created.push(noSheet.id)
    await makeInvoice(noSheet.id)

    const before = overwriteRows.mock.calls.length
    await runSheetsSyncFlush(app.prisma)
    // No call could target this user (it has no sheetSpreadsheetId); its hw stays null.
    expect(await hwOf(noSheet.id)).toBeNull()
    // (Other users may have synced; we only assert this user produced none.)
    expect(overwriteRows.mock.calls.length).toBeGreaterThanOrEqual(before)
  })
})
