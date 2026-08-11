import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { AppError } from '../src/middleware/errorHandler'

// Mock the sheets seam — no live Google calls. checkAccess/serviceAccountEmail
// are controllable per test; overwriteRows is captured to prove export targeting
// ("Sync now" full-mirrors via overwriteRows).
const sheets = vi.hoisted(() => ({
  serviceAccountEmail: vi.fn(() => 'svc@project.iam.gserviceaccount.com'),
  checkAccess: vi.fn(async () => {}),
  appendRows: vi.fn(async () => {}),
  overwriteRows: vi.fn(async () => ({ resizeError: null })),
  resolveSheetTab: vi.fn(async () => ({ sheetId: 123, typedColumnIndexes: [], table: null })),
  applyColumnDropdowns: vi.fn(async () => {}),
}))
vi.mock('../src/integrations/sheets', () => sheets)

import { buildApp } from '../src/app'
import { createSecondUser } from './helpers/auth'

// Realistic Drive file ids — SaveSheetSchema rejects anything that isn't one,
// and each is distinct because users.sheetSpreadsheetId is UNIQUE. Randomized
// per run (following apps/api/test/sheets.sync.test.ts and
// apps/api/test/invoices.export.test.ts:36-39) rather than fixed literals: a
// fixed id left behind by an aborted run would make later runs fail
// confusingly on a stale UNIQUE collision instead of the test's own assertion.
const uniq = () => Math.random().toString(36).slice(2, 10)
const ID_SAVED = `1SettingsSheetsSavedAAAAAAAAAAAAAAAAAAAAAAAA-${uniq()}`
const ID_UNREACHABLE = `1SettingsSheetsUnreachableBBBBBBBBBBBBBBBBBB-${uniq()}`
const ID_TARGET = `1SettingsSheetsSyncNowCCCCCCCCCCCCCCCCCCCCCC-${uniq()}`
const ID_DISCONNECT = `1SettingsSheetsDisconnectKKKKKKKKKKKKKKKKKK-${uniq()}`
const ID_RELEASED = `1SettingsSheetsReleasedLLLLLLLLLLLLLLLLLLLL-${uniq()}`
const ID_UNAUTH = `1SettingsSheetsUnauthMMMMMMMMMMMMMMMMMMMMMM-${uniq()}`
const ID_RESET_SAVE = `1SettingsSheetsResetOnSaveNNNNNNNNNNNNNNNNN-${uniq()}`
const ID_RESET_DISC = `1SettingsSheetsResetOnDiscOOOOOOOOOOOOOOOOO-${uniq()}`
const ID_NO_TARGET = `1SettingsSheetsNoTargetPPPPPPPPPPPPPPPPPPPP-${uniq()}`

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
const get = () =>
  app.inject({ method: 'GET', url: '/api/settings/sheets', headers: { cookie: cookie() } })
const save = (spreadsheetId: string) =>
  app.inject({
    method: 'PATCH',
    url: '/api/settings/sheets',
    payload: { spreadsheetId },
    headers: { cookie: cookie() },
  })
const test = () =>
  app.inject({ method: 'POST', url: '/api/settings/sheets/test', headers: { cookie: cookie() } })
const disconnect = () =>
  app.inject({ method: 'DELETE', url: '/api/settings/sheets', headers: { cookie: cookie() } })

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
    const res = await save(ID_SAVED)
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe(ID_SAVED)
    expect(
      (await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).sheetSpreadsheetId,
    ).toBe(ID_SAVED)
  })

  it('test connection surfaces the share-as-Editor error, not a raw error (AE3)', async () => {
    await save(ID_UNREACHABLE)
    sheets.checkAccess.mockRejectedValueOnce(
      new AppError(
        'SHEET_PERMISSION_DENIED',
        'share it as Editor with the service-account email',
        502,
      ),
    )
    const res = await test()
    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toMatch(/share it as Editor/)
  })

  it('"Sync now" mirrors to the saved spreadsheet id', async () => {
    await save(ID_TARGET)
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
    const res = await app.inject({
      method: 'POST',
      url: '/api/invoices/export',
      payload: {},
      headers: { cookie: cookie() },
    })
    expect(res.statusCode).toBe(200)
    expect(sheets.overwriteRows).toHaveBeenCalled()
    expect(sheets.overwriteRows.mock.calls[0][0]).toBe(ID_TARGET) // targeted the saved id
  })

  it('the database refuses two accounts pointing at one spreadsheet', async () => {
    // Direct Prisma writes, deliberately bypassing the API: this asserts the
    // INDEX exists, not the handler's error translation (that is a separate
    // test). Without the index this write simply succeeds.
    const shared = `1DbLevelUniquenessDDDDDDDDDDDDDDDDDDDDDDDDD-${uniq()}`
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: u.user.id },
        data: { sheetSpreadsheetId: shared },
      })
      await expect(
        app.prisma.user.update({
          where: { id: other.user.id },
          data: { sheetSpreadsheetId: shared },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    } finally {
      await app.prisma.user.update({
        where: { id: u.user.id },
        data: { sheetSpreadsheetId: null },
      })
      await other.cleanup()
    }
  })

  it('allows any number of accounts with no connected sheet (AE6)', async () => {
    // NULL is distinct from NULL in a Postgres unique index. Without this the
    // constraint would let exactly one landlord be unconnected, which would
    // break signup outright — worth pinning rather than trusting.
    const a = await createSecondUser(app)
    const b = await createSecondUser(app)
    try {
      const both = await app.prisma.user.findMany({
        where: { id: { in: [a.user.id, b.user.id] } },
        select: { sheetSpreadsheetId: true },
      })
      expect(both).toHaveLength(2)
      expect(both.every((x) => x.sheetSpreadsheetId === null)).toBe(true)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  it('refuses a spreadsheet another account has already connected (AE1)', async () => {
    const taken = `1AlreadyConnectedElsewhereEEEEEEEEEEEEEEEEE-${uniq()}`
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: other.user.id },
        data: { sheetSpreadsheetId: taken },
      })
      const res = await save(taken)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('SHEET_ALREADY_CONNECTED')
      expect(res.json().error.message).toMatch(/already connected to another account/)
      // The other account's identity must never leak in the message.
      expect(res.json().error.message).not.toMatch(other.user.email)
      // And our own target is untouched by the failed save.
      const me = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
      expect(me.sheetSpreadsheetId).not.toBe(taken)
    } finally {
      await other.cleanup()
    }
  })

  it('refuses the URL form of a spreadsheet another account holds as a bare id (AE2)', async () => {
    // The reason normalization exists: without it these are two different
    // strings, the unique index sees no conflict, and the wipe still happens.
    const taken = `1UrlFormCollidesFFFFFFFFFFFFFFFFFFFFFFFFFFF-${uniq()}`
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: other.user.id },
        data: { sheetSpreadsheetId: taken },
      })
      const res = await save(`https://docs.google.com/spreadsheets/d/${taken}/edit#gid=0`)
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('SHEET_ALREADY_CONNECTED')
    } finally {
      await other.cleanup()
    }
  })

  it('lets a landlord re-save their own current spreadsheet (AE4)', async () => {
    const mine = `1MyOwnSheetReSavedGGGGGGGGGGGGGGGGGGGGGGGGG-${uniq()}`
    expect((await save(mine)).statusCode).toBe(200)
    // Same row, same value — not a collision.
    const res = await save(mine)
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe(mine)
  })

  it('rejects input that is not a spreadsheet id or URL (AE5)', async () => {
    const before = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } }))
      .sheetSpreadsheetId
    const res = await save('my sheet')
    expect(res.statusCode).toBe(400)
    // The landlord must SEE why. `errOf` in the web Settings page renders
    // `error.message` only — it never reads `details` — so a generic
    // "Invalid request body" here would leave the person staring at a
    // rejected field with no idea what shape is wanted.
    expect(res.json().error.message).toMatch(/Google Sheets ID or URL/)
    const after = (await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } }))
      .sheetSpreadsheetId
    expect(after).toBe(before) // nothing stored
  })

  it('frees the spreadsheet when the holding account is deleted (AE8)', async () => {
    const contested = `1FreedOnDeleteHHHHHHHHHHHHHHHHHHHHHHHHHHHH-${uniq()}`
    const other = await createSecondUser(app)
    try {
      await app.prisma.user.update({
        where: { id: other.user.id },
        data: { sheetSpreadsheetId: contested },
      })
      expect((await save(contested)).statusCode).toBe(409)
    } finally {
      // Unlike every literal fixture id in this file, `contested` is only
      // freed by deleting `other` — so if the assertion above throws before
      // cleanup runs, this id is claimed forever and poisons every later run.
      await other.cleanup()
    }
    expect((await save(contested)).statusCode).toBe(200)
  })

  it('stores the bare id when a non-colliding URL is saved (AE3)', async () => {
    const bare = `1SettingsSheetsUrlFormStoresBareIdJJJJJJJJJ-${uniq()}`
    const res = await save(`https://docs.google.com/spreadsheets/d/${bare}/edit#gid=0`)
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBe(bare)
  })

  it('disconnects a connected spreadsheet (AE1)', async () => {
    expect((await save(ID_DISCONNECT)).statusCode).toBe(200)
    const res = await disconnect()
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBeNull()
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSpreadsheetId).toBeNull()
  })

  it('releases the spreadsheet for another account (AE2)', async () => {
    expect((await save(ID_RELEASED)).statusCode).toBe(200)
    await disconnect()
    const other = await createSecondUser(app)
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/sheets',
        payload: { spreadsheetId: ID_RELEASED },
        headers: { cookie: other.cookie },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().targetSpreadsheetId).toBe(ID_RELEASED)
    } finally {
      await other.cleanup()
    }
  })

  it('is idempotent when nothing is connected (AE3)', async () => {
    await disconnect()
    const res = await disconnect()
    expect(res.statusCode).toBe(200)
    expect(res.json().targetSpreadsheetId).toBeNull()
  })

  it('rejects an unauthenticated disconnect and changes nothing (AE4)', async () => {
    expect((await save(ID_UNAUTH)).statusCode).toBe(200)
    const res = await app.inject({ method: 'DELETE', url: '/api/settings/sheets' })
    expect(res.statusCode).toBe(401)
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSpreadsheetId).toBe(ID_UNAUTH)
  })

  // AE5/AE6 are the tests that would have caught the stale-sync bug: without
  // the reset, runSheetsSyncFlush compares invoice/property timestamps against
  // sheetSyncedAt, neither of which a target change touches — so the landlord
  // reads as clean and the newly connected sheet is never populated.
  it('clears the sync high-water mark when a target is saved (AE5)', async () => {
    await app.prisma.user.update({
      where: { id: u.user.id },
      data: { sheetSyncedAt: new Date('2026-01-01T00:00:00Z') },
    })
    await save(ID_RESET_SAVE)
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSyncedAt).toBeNull()
  })

  it('clears the sync high-water mark on disconnect (AE6)', async () => {
    await save(ID_RESET_DISC)
    await app.prisma.user.update({
      where: { id: u.user.id },
      data: { sheetSyncedAt: new Date('2026-01-01T00:00:00Z') },
    })
    await disconnect()
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })
    expect(row.sheetSyncedAt).toBeNull()
  })

  it('export and test both report no sheet connected after a disconnect (AE9)', async () => {
    expect((await save(ID_NO_TARGET)).statusCode).toBe(200)
    await disconnect()

    const exported = await app.inject({
      method: 'POST',
      url: '/api/invoices/export',
      payload: {},
      headers: { cookie: cookie() },
    })
    expect(exported.statusCode).toBe(400)
    expect(exported.json().error.code).toBe('SHEET_NOT_CONNECTED')

    const tested = await test()
    expect(tested.statusCode).toBe(400)
    expect(tested.json().error.message).toMatch(/No target spreadsheet set/)
  })
})
