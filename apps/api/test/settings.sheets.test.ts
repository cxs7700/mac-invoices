import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { AppError } from '../src/middleware/errorHandler'

// Mock the sheets seam — no live Google calls. checkAccess/serviceAccountEmail
// are controllable per test; overwriteRows is captured to prove export targeting
// ("Sync now" full-mirrors via overwriteRows).
const sheets = vi.hoisted(() => ({
  serviceAccountEmail: vi.fn(() => 'svc@project.iam.gserviceaccount.com'),
  checkAccess: vi.fn(async () => {}),
  appendRows: vi.fn(async () => {}),
  overwriteRows: vi.fn(async () => {}),
  resolveSheetTab: vi.fn(async () => ({ sheetId: 123, typedColumnIndexes: [] })),
  applyColumnDropdowns: vi.fn(async () => {}),
}))
vi.mock('../src/integrations/sheets', () => sheets)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

const app = buildApp()
let u: Awaited<ReturnType<typeof createSecondUser>>

beforeAll(async () => {
  await app.ready()
  u = await createSecondUser(app)
})
afterAll(async () => {
  await app.prisma.invoice.deleteMany({ where: { userId: u.user.id } })
  await u.cleanup()
  await app.close()
})

const cookie = () => u.cookie
const get = () => app.inject({ method: 'GET', url: '/api/settings/sheets', headers: { cookie: cookie() } })
const save = (spreadsheetId: string) =>
  app.inject({ method: 'PATCH', url: '/api/settings/sheets', payload: { spreadsheetId }, headers: { cookie: cookie() } })
const test = () => app.inject({ method: 'POST', url: '/api/settings/sheets/test', headers: { cookie: cookie() } })

describe('Sheets settings', () => {
  it('GET status returns null targetSpreadsheetId for a user with no saved sheet — no server-side fallback of any kind', async () => {
    // `u` is a fresh non-landlord tenant (createSecondUser) with no saved
    // sheet. There is no env fallback to guard against anymore (it was
    // removed entirely — see DEC-029(i)), so this simply proves the status
    // read reflects the DB column as-is.
    const before = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(before.sheetSpreadsheetId).toBeNull()
    const body = (await get()).json()
    expect(body.targetSpreadsheetId).toBeNull()
  })

  it('GET status: configured + service-account email, never the key (AE5)', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.configured).toBe(true)
    expect(body.serviceAccountEmail).toBe('svc@project.iam.gserviceaccount.com')
    expect(JSON.stringify(body)).not.toMatch(/private_key|GOOGLE_SERVICE_ACCOUNT_KEY/)
  })

  it('reports configured:false cleanly when credentials are unset (no crash)', async () => {
    sheets.serviceAccountEmail.mockImplementationOnce(() => {
      throw new AppError('EXPORT_NOT_CONFIGURED', 'not configured', 503)
    })
    const body = (await get()).json()
    expect(body.configured).toBe(false)
    expect(body.serviceAccountEmail).toBeNull()
  })

  it('saves a target spreadsheet id and reflects it in status', async () => {
    const res = await save('SHEET-ABC')
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe('SHEET-ABC')
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).sheetSpreadsheetId).toBe('SHEET-ABC')
  })

  it('test connection surfaces the share-as-Editor error, not a raw error (AE3)', async () => {
    await save('UNREACHABLE')
    sheets.checkAccess.mockRejectedValueOnce(
      new AppError('SHEET_PERMISSION_DENIED', 'share it as Editor with the service-account email', 502),
    )
    const res = await test()
    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toMatch(/share it as Editor/)
  })

  it('"Sync now" mirrors to the saved spreadsheet id', async () => {
    await save('SAVED-TARGET')
    // Give the user an invoice so the mirror has a data row.
    await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        vendorName: 'V',
        items: [{ description: 'w', quantity: 1, total: 10 }],
        category: 'OTHER',
        invoiceDate: '2026-06-01',
      },
      headers: { cookie: cookie() },
    })
    sheets.overwriteRows.mockClear()
    const res = await app.inject({ method: 'POST', url: '/api/invoices/export', payload: {}, headers: { cookie: cookie() } })
    expect(res.statusCode).toBe(200)
    expect(sheets.overwriteRows).toHaveBeenCalled()
    expect(sheets.overwriteRows.mock.calls[0][0]).toBe('SAVED-TARGET') // targeted the saved id
  })
})
