import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'

// Mock the Sheets seam — no live Google calls (DoD). "Sync now" full-mirrors via
// overwriteRows; the other exports are stubbed so the app's settings routes still
// import cleanly.
const {
  overwriteRows,
  appendRows,
  checkAccess,
  serviceAccountEmail,
  resolveSheetTab,
  applyColumnFormatting,
} = vi.hoisted(() => ({
  overwriteRows: vi.fn(async () => ({ resizeError: null })),
  appendRows: vi.fn(async () => {}),
  checkAccess: vi.fn(async () => {}),
  serviceAccountEmail: vi.fn(() => 'svc@x.iam.gserviceaccount.com'),
  resolveSheetTab: vi.fn(async () => ({ sheetId: 123, typedColumnIndexes: [], table: null })),
  applyColumnFormatting: vi.fn(async () => {}),
}))
vi.mock('../src/integrations/sheets', () => ({
  overwriteRows,
  appendRows,
  checkAccess,
  serviceAccountEmail,
  resolveSheetTab,
  applyColumnFormatting,
}))

import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'
import { AppError } from '../src/middleware/errorHandler'

const app = buildApp()
const NONCE = 'ZZTEST-EXPORT-'
// Randomized per run (following apps/api/test/sheets.sync.test.ts) rather than
// a fixed literal: `sheetSpreadsheetId` is UNIQUE, so a fixed id left behind
// by an aborted run would make every later run's beforeAll throw P2002.
const uniq = () => Math.random().toString(36).slice(2, 10)
const SHEET_TEST_ID = `SHEET-TEST-${uniq()}`
let landlord: string
let user: Awaited<ReturnType<typeof createSecondUser>>

const body = (n: string, extra: Record<string, unknown> = {}) => ({
  invoiceNumber: `${NONCE}${n}`,
  vendorName: 'Vendor',
  items: [{ description: 'Work', quantity: 1, total: 100 }],
  category: 'OTHER',
  invoiceDate: '2026-02-01',
  ...extra,
})

async function create(n: string, cookie: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    headers: { cookie },
    payload: body(n, extra),
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

const exportAs = (cookie: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/invoices/export', headers: { cookie }, payload })

// Data rows from the most recent mirror call (row 0 is the header).
const lastDataRows = () => (overwriteRows.mock.calls.at(-1)![1] as unknown[][]).slice(1)

beforeAll(async () => {
  // Raise the export rate-limit before routes register, so the many test exports
  // (one shared loopback IP) don't trip the production cap of 5.
  process.env.EXPORT_RATE_LIMIT_MAX = '100000'
  await app.ready()
  landlord = await loginCookie(app)
  user = await createSecondUser(app)
  // There is no env fallback anymore — every user, including `user` here,
  // must have a SAVED target for the content/filtering/scoping tests below
  // (which only care that mirroring happens, not how the target was set) to
  // exercise a successful export.
  await app.prisma.user.update({
    where: { id: user.user.id },
    data: { sheetSpreadsheetId: SHEET_TEST_ID },
  })
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
  await user.cleanup()
  await app.close()
  delete process.env.EXPORT_RATE_LIMIT_MAX
})
beforeEach(() => {
  overwriteRows.mockReset().mockResolvedValue({ resizeError: null })
})
afterEach(async () => {
  const invs = await app.prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: NONCE } },
    select: { id: true },
  })
  await app.prisma.invoiceEvent.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
})

describe('POST /api/invoices/export — "Sync now" full mirror', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invoices/export', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('mirrors all exportable invoices (header + rows) to the saved target and reports the row count', async () => {
    await create('1', user.cookie)
    await create('2', user.cookie)
    await create('3', user.cookie)

    const eventsBefore = await app.prisma.invoiceEvent.count({
      where: { ownerUserId: user.user.id },
    })
    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ exported: 3 })
    expect(overwriteRows).toHaveBeenCalledTimes(1)
    expect(overwriteRows.mock.calls[0][0]).toBe(SHEET_TEST_ID)
    const rows = overwriteRows.mock.calls[0][1] as unknown[][]
    expect(rows).toHaveLength(4) // header + 3 data rows
    expect(rows[0]).toContain('Invoice #') // header row
    expect(rows[0]).toContain('Amount')
    // Mirror emits no ledger events.
    expect(await app.prisma.invoiceEvent.count({ where: { ownerUserId: user.user.id } })).toBe(
      eventsBefore,
    )

    // A second sync re-mirrors everything (full mirror, not incremental).
    const again = await exportAs(user.cookie)
    expect(again.json()).toEqual({ exported: 3 })
    expect(overwriteRows).toHaveBeenCalledTimes(2)
  })

  it('excludes SUBMITTED/REJECTED/CANCELLED invoices from the mirror', async () => {
    await create('keep', user.cookie)
    const cancelled = await create('gone', user.cookie)
    await app.prisma.invoice.update({ where: { id: cancelled }, data: { status: 'CANCELLED' } })

    const res = await exportAs(user.cookie)
    expect(res.json()).toEqual({ exported: 1 })
    const numbers = lastDataRows().map((r) => r[0])
    expect(numbers).toContain(`${NONCE}keep`)
    expect(numbers).not.toContain(`${NONCE}gone`)
  })

  it("never mirrors another user's invoices", async () => {
    await create('mine', user.cookie)
    await create('landlords', landlord) // a different owner

    await exportAs(user.cookie)
    const numbers = lastDataRows().map((r) => r[0])
    expect(numbers).toContain(`${NONCE}mine`)
    expect(numbers).not.toContain(`${NONCE}landlords`)
  })

  it('400s SHEET_NOT_CONNECTED when a non-landlord user has no saved sheet', async () => {
    // A fresh non-landlord user with no saved sheet — `user` (above) now
    // always has a saved target, so this needs its own fixture.
    const noSheet = await createSecondUser(app)
    try {
      await create('x', noSheet.cookie)

      const bad = await exportAs(noSheet.cookie)
      expect(bad.statusCode).toBe(400)
      expect(bad.json().error.code).toBe('SHEET_NOT_CONNECTED')

      // The body spreadsheetId is accepted by the schema but no longer overrides the
      // owner-scoped target — still 400 with no saved target.
      const stillBad = await exportAs(noSheet.cookie, { spreadsheetId: 'BODY-SHEET' })
      expect(stillBad.statusCode).toBe(400)
      expect(overwriteRows).not.toHaveBeenCalled()
    } finally {
      await noSheet.cleanup()
    }
  })

  it('inversion: the seeded landlord ALSO gets SHEET_NOT_CONNECTED with no saved sheet — the env fallback is gone entirely', async () => {
    // The env fallback used to be gated to LANDLORD_USER_ID only (so the
    // landlord alone inherited GOOGLE_SHEET_ID). That gate has since been
    // removed outright: every user, including the seeded landlord, now reads
    // ONLY User.sheetSpreadsheetId. This is the core assertion of that change.
    const before = await app.prisma.user.findUniqueOrThrow({
      where: { id: process.env.LANDLORD_USER_ID ?? 'landlord_seed_user' },
      select: { sheetSpreadsheetId: true },
    })
    expect(before.sheetSpreadsheetId).toBeNull() // precondition: no saved sheet
    const res = await exportAs(landlord)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('SHEET_NOT_CONNECTED')
    expect(overwriteRows).not.toHaveBeenCalled()
  })

  it('propagates a sanitized Sheets failure (no partial-count bookkeeping)', async () => {
    await create('x', user.cookie)
    overwriteRows.mockRejectedValueOnce(new AppError('SHEET_ERROR', 'boom', 502))
    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe('SHEET_ERROR')
  })

  it('propagates the 503 when Sheets is unconfigured', async () => {
    await create('x', user.cookie)
    overwriteRows.mockRejectedValueOnce(
      new AppError('EXPORT_NOT_CONFIGURED', 'not configured', 503),
    )
    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(503)
  })

  it('maps cells: amount number, empty propertyAddress, partsOrdered passthrough', async () => {
    await create('map', user.cookie, {
      items: [{ description: 'Work', quantity: 1, total: 149.99 }],
      partsOrdered: '2x faucet washers',
    })
    await exportAs(user.cookie)
    const row = lastDataRows()[0]
    // [invoiceNumber, invoiceDate, description, propertyAddress, amount, category, status, notes, partsOrdered, invoiceLink]
    expect(row[4]).toBe(149.99)
    expect(typeof row[4]).toBe('number')
    expect(row[3]).toBe('') // propertyAddress empty (no property assigned)
    expect(row[8]).toBe('2x faucet washers')
  })

  it("mirrors the assigned property's address in the propertyAddress column", async () => {
    const prop = await app.prisma.property.create({
      data: { landlordId: user.user.id, name: 'P-EXP', address: '742 Evergreen Terrace' },
    })
    try {
      await create('withprop', user.cookie, { propertyId: prop.id })
      await exportAs(user.cookie)
      expect(lastDataRows()[0][3]).toBe('742 Evergreen Terrace')
    } finally {
      await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
      await app.prisma.property.delete({ where: { id: prop.id } }).catch(() => {})
    }
  })
})

describe('POST /api/invoices/export — rate limit', () => {
  // A separate app whose export cap is low; the main app uses 100000.
  const rlApp = buildApp()
  let rlCookie: string
  let rlCleanup: () => Promise<void>

  beforeAll(async () => {
    process.env.EXPORT_RATE_LIMIT_MAX = '2'
    await rlApp.ready()
    const u = await createSecondUser(rlApp)
    rlCookie = u.cookie
    rlCleanup = u.cleanup
    // There is no env fallback — give the fixture user a saved target so this
    // suite (about the rate limit, not target resolution) still exercises a
    // successful export.
    await rlApp.prisma.user.update({
      where: { id: u.user.id },
      data: { sheetSpreadsheetId: `SHEET-RL-${uniq()}` },
    })
  })
  afterAll(async () => {
    await rlCleanup()
    await rlApp.close()
    process.env.EXPORT_RATE_LIMIT_MAX = '100000'
  })

  it('429s with TOO_MANY_REQUESTS after the cap', async () => {
    overwriteRows.mockResolvedValue({ resizeError: null })
    const ex = () =>
      rlApp.inject({
        method: 'POST',
        url: '/api/invoices/export',
        headers: { cookie: rlCookie },
        payload: {},
      })
    // The rlUser owns no invoices → each sync is 200 { exported: 0 } until the cap trips.
    expect((await ex()).statusCode).toBe(200)
    expect((await ex()).statusCode).toBe(200)
    const limited = await ex()
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('TOO_MANY_REQUESTS')
  })
})
