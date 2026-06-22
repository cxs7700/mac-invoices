import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'

// Mock the Sheets module — no live Google calls (DoD).
const { appendRows } = vi.hoisted(() => ({ appendRows: vi.fn() }))
vi.mock('../src/integrations/sheets', () => ({ appendRows }))

import { buildApp } from '../src/app'
import { loginCookie, createSecondUser } from './helpers/auth'
import { AppError } from '../src/middleware/errorHandler'

const app = buildApp()
const NONCE = 'ZZTEST-EXPORT-'
let landlord: string
let user: Awaited<ReturnType<typeof createSecondUser>>

const body = (n: string, extra: Record<string, unknown> = {}) => ({
  invoiceNumber: `${NONCE}${n}`,
  vendorName: 'Vendor',
  description: 'Work',
  amount: 100,
  category: 'OTHER',
  invoiceDate: '2026-02-01',
  ...extra,
})

async function create(n: string, cookie: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/invoices', headers: { cookie }, payload: body(n, extra) })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

const exportAs = (cookie: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/invoices/export', headers: { cookie }, payload })

beforeAll(async () => {
  // Raise the export rate-limit before routes register, so the many test exports
  // (one shared loopback IP) don't trip the production cap of 5.
  process.env.EXPORT_RATE_LIMIT_MAX = '100000'
  await app.ready()
  landlord = await loginCookie(app)
  user = await createSecondUser(app)
  process.env.GOOGLE_SHEET_ID = 'SHEET-TEST'
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
  await user.cleanup()
  await app.close()
  delete process.env.GOOGLE_SHEET_ID
})
beforeEach(() => {
  appendRows.mockReset().mockResolvedValue(undefined)
  delete process.env.EXPORT_CHUNK_SIZE
  process.env.GOOGLE_SHEET_ID = 'SHEET-TEST'
})
afterEach(async () => {
  // Each test starts with the second user owning zero invoices.
  await app.prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: NONCE } } })
})

describe('POST /api/invoices/export', () => {
  it('401s without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/invoices/export', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('appends the un-synced invoices, stamps them, and reports the count', async () => {
    await create('1', user.cookie)
    await create('2', user.cookie)
    await create('3', user.cookie)

    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ exported: 3 })
    expect(appendRows).toHaveBeenCalledTimes(1)
    expect(appendRows.mock.calls[0][0]).toBe('SHEET-TEST')
    expect(appendRows.mock.calls[0][1]).toHaveLength(3)

    // A second export sees nothing un-synced.
    const again = await exportAs(user.cookie)
    expect(again.json()).toEqual({ exported: 0 })
    expect(appendRows).toHaveBeenCalledTimes(1)
  })

  it("never exports another user's invoices", async () => {
    await create('mine', user.cookie)
    await create('landlords', landlord) // a different owner

    await exportAs(user.cookie)
    const appended = (appendRows.mock.calls[0][1] as string[][]).map((r) => r[1])
    expect(appended).toContain(`${NONCE}mine`)
    expect(appended).not.toContain(`${NONCE}landlords`)
  })

  it('chunks at the configured size and stamps every chunk', async () => {
    process.env.EXPORT_CHUNK_SIZE = '2'
    await create('a', user.cookie)
    await create('b', user.cookie)
    await create('c', user.cookie)

    const res = await exportAs(user.cookie)
    expect(res.json()).toEqual({ exported: 3 })
    expect(appendRows).toHaveBeenCalledTimes(2) // 2 + 1
  })

  it('on a mid-export chunk failure, stamps what succeeded and 502s with the durable count', async () => {
    process.env.EXPORT_CHUNK_SIZE = '2'
    await create('a', user.cookie)
    await create('b', user.cookie)
    await create('c', user.cookie)
    appendRows
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new AppError('SHEET_ERROR', 'boom', 502))

    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.details).toEqual({ exported: 2 })

    // The 1 un-stamped row remains exportable — a retry resumes only it.
    appendRows.mockReset().mockResolvedValue(undefined)
    const retry = await exportAs(user.cookie)
    expect(retry.json()).toEqual({ exported: 1 })
    expect(appendRows.mock.calls[0][1]).toHaveLength(1)
  })

  it('400s when no target spreadsheet is resolvable; a body id overrides env', async () => {
    delete process.env.GOOGLE_SHEET_ID
    await create('x', user.cookie)
    const bad = await exportAs(user.cookie)
    expect(bad.statusCode).toBe(400)

    const ok = await exportAs(user.cookie, { spreadsheetId: 'BODY-SHEET' })
    expect(ok.statusCode).toBe(200)
    expect(appendRows.mock.calls[0][0]).toBe('BODY-SHEET')
  })

  it('propagates the 503 when export is unconfigured', async () => {
    await create('x', user.cookie)
    appendRows.mockRejectedValue(new AppError('EXPORT_NOT_CONFIGURED', 'not configured', 503))
    const res = await exportAs(user.cookie)
    expect(res.statusCode).toBe(503)
  })

  it('maps cells: amount as a number, null dueDate as an empty cell', async () => {
    await create('map', user.cookie, { amount: 149.99 })
    await exportAs(user.cookie)
    const row = (appendRows.mock.calls[0][1] as unknown[][])[0]
    // [id, invoiceNumber, vendorName, amount, status, invoiceDate, dueDate, category, description]
    expect(row[3]).toBe(149.99)
    expect(typeof row[3]).toBe('number')
    expect(row[6]).toBe('') // dueDate null
  })
})
