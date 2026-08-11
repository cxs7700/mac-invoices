import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock googleapis so no network call happens.
const appendMock = vi.fn()
const clearMock = vi.fn()
const updateMock = vi.fn()
const getMock = vi.fn()
const batchUpdateMock = vi.fn()
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: vi.fn(() => ({})) },
    sheets: vi.fn(() => ({
      spreadsheets: {
        get: getMock,
        batchUpdate: batchUpdateMock,
        values: { append: appendMock, clear: clearMock, update: updateMock },
      },
    })),
  },
}))

import {
  appendRows,
  overwriteRows,
  resolveSheetTab,
  applyColumnDropdowns,
  resizeTableRows,
} from '../../src/integrations/sheets'
import { SheetFormula } from '../../src/integrations/sheetCells'

const VALID_KEY = JSON.stringify({ client_email: 'sa@x.iam', private_key: 'PRIVATE-SECRET-123' })

beforeEach(() => {
  appendMock.mockReset()
  clearMock.mockReset().mockResolvedValue({})
  updateMock.mockReset().mockResolvedValue({})
  getMock.mockReset()
  batchUpdateMock.mockReset().mockResolvedValue({})
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_KEY
  process.env.SHEETS_RETRY_BASE_MS = '1'
  delete process.env.GOOGLE_SHEET_TAB
})
afterEach(() => {
  delete process.env.SHEETS_RETRY_BASE_MS
})

describe('sheets.appendRows', () => {
  it('appends to the pinned tab with USER_ENTERED and a timeout', async () => {
    appendMock.mockResolvedValue({})
    await appendRows('SHEET-1', [['a', 1]])
    expect(appendMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      range: 'Invoices!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['a', 1]] },
    })
    expect(appendMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('neutralizes formula-injection in text cells (leading =,+,-,@)', async () => {
    appendMock.mockResolvedValue({})
    await appendRows('S', [['=IMPORTXML("http://evil")', '+1', 'safe', 42, '-bad', '@x']])
    expect(appendMock.mock.calls[0][0].requestBody.values[0]).toEqual([
      '\'=IMPORTXML("http://evil")',
      "'+1",
      'safe',
      42,
      "'-bad",
      "'@x",
    ])
  })

  it('passes a server-constructed SheetFormula through verbatim (not neutralized)', async () => {
    appendMock.mockResolvedValue({})
    await appendRows('S', [[new SheetFormula('=HYPERLINK("https://app/i/1", "Link")'), 'safe']])
    expect(appendMock.mock.calls[0][0].requestBody.values[0]).toEqual([
      '=HYPERLINK("https://app/i/1", "Link")',
      'safe',
    ])
  })

  it('retries a transient 5xx then resolves', async () => {
    appendMock.mockRejectedValueOnce({ code: 503 }).mockResolvedValueOnce({})
    await appendRows('S', [['x']])
    expect(appendMock).toHaveBeenCalledTimes(2)
  })

  it('reads the status from err.response.status (real GaxiosError shape) and retries', async () => {
    appendMock.mockRejectedValueOnce({ response: { status: 429 } }).mockResolvedValueOnce({})
    await appendRows('S', [['x']])
    expect(appendMock).toHaveBeenCalledTimes(2)
  })

  it('retries a transport error (ECONNRESET) then resolves', async () => {
    appendMock.mockRejectedValueOnce({ code: 'ECONNRESET' }).mockResolvedValueOnce({})
    await appendRows('S', [['x']])
    expect(appendMock).toHaveBeenCalledTimes(2)
  })

  it('uses GOOGLE_SHEET_TAB when set', async () => {
    process.env.GOOGLE_SHEET_TAB = 'Exports'
    appendMock.mockResolvedValue({})
    await appendRows('S', [['x']])
    expect(appendMock.mock.calls[0][0].range).toBe('Exports!A1')
  })

  it('retries a 429 then resolves', async () => {
    appendMock.mockRejectedValueOnce({ code: 429 }).mockResolvedValueOnce({})
    await appendRows('S', [['x']])
    expect(appendMock).toHaveBeenCalledTimes(2)
  })

  it('rejects after exhausting retries on persistent 429 (bounded, sanitized)', async () => {
    appendMock.mockRejectedValue({ code: 429 })
    await expect(appendRows('S', [['x']])).rejects.toMatchObject({ code: 'SHEET_RATE_LIMITED' })
    expect(appendMock).toHaveBeenCalledTimes(4)
  })

  it('throws a typed 503 when the key is unset', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    await expect(appendRows('S', [['x']])).rejects.toMatchObject({
      code: 'EXPORT_NOT_CONFIGURED',
      statusCode: 503,
    })
    expect(appendMock).not.toHaveBeenCalled()
  })

  it('throws a typed 503 when the key is malformed JSON (not an uncaught SyntaxError)', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{not valid json'
    await expect(appendRows('S', [['x']])).rejects.toMatchObject({
      code: 'EXPORT_NOT_CONFIGURED',
      statusCode: 503,
    })
  })

  it('sanitizes a googleapis error — never leaks credentials', async () => {
    appendMock.mockRejectedValue({
      code: 403,
      config: { headers: { Authorization: 'Bearer PRIVATE-SECRET-123' } },
      message: 'caller does not have permission for PRIVATE-SECRET-123',
    })
    const err = await appendRows('S', [['x']]).catch((e) => e)
    expect(err).toMatchObject({ code: 'SHEET_PERMISSION_DENIED', statusCode: 502 })
    // The thrown error must not carry the raw payload / secret on ANY property
    // (message, details, cause, stack) — the central errorHandler logs the whole error.
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })
})

describe('sheets.overwriteRows (full mirror)', () => {
  it('clears the whole tab then writes the rows at A1 (USER_ENTERED, timeouts)', async () => {
    await overwriteRows('SHEET-1', [
      ['id', 'invoiceNumber'],
      ['abc', 'INV-1'],
    ])
    expect(clearMock.mock.calls[0][0]).toEqual({ spreadsheetId: 'SHEET-1', range: 'Invoices' })
    expect(clearMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
    expect(updateMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      range: 'Invoices!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['id', 'invoiceNumber'],
          ['abc', 'INV-1'],
        ],
      },
    })
    expect(updateMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('neutralizes formula-injection in mirrored cells', async () => {
    await overwriteRows('S', [['=HYPERLINK("http://evil")', 'safe']])
    expect(updateMock.mock.calls[0][0].requestBody.values[0]).toEqual([
      '\'=HYPERLINK("http://evil")',
      'safe',
    ])
  })

  it('retries a transient 429 on the clear step then resolves', async () => {
    clearMock.mockReset().mockRejectedValueOnce({ code: 429 }).mockResolvedValueOnce({})
    await overwriteRows('S', [['x']])
    expect(clearMock).toHaveBeenCalledTimes(2)
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it('sanitizes an update-step error and does not leak credentials', async () => {
    updateMock
      .mockReset()
      .mockRejectedValue({ code: 403, message: 'no access to PRIVATE-SECRET-123' })
    const err = await overwriteRows('S', [['x']]).catch((e) => e)
    expect(err).toMatchObject({ code: 'SHEET_PERMISSION_DENIED', statusCode: 502 })
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })

  it('uses GOOGLE_SHEET_TAB for both the clear range and the update anchor', async () => {
    process.env.GOOGLE_SHEET_TAB = 'Exports'
    await overwriteRows('S', [['x']])
    expect(clearMock.mock.calls[0][0].range).toBe('Exports')
    expect(updateMock.mock.calls[0][0].range).toBe('Exports!A1')
  })
})

describe('sheets.resolveSheetTab', () => {
  const tabs = (props: Array<{ sheetId: number | null; title: string }>) => ({
    data: { sheets: props.map((p) => ({ properties: p })) },
  })

  it('returns the matching tab sheetId among several tabs, with a fields mask and timeout', async () => {
    getMock.mockResolvedValue(
      tabs([
        { sheetId: 77, title: 'Summary' },
        { sheetId: 123, title: 'Invoices' },
      ]),
    )
    await expect(resolveSheetTab('SHEET-1')).resolves.toEqual({
      sheetId: 123,
      typedColumnIndexes: [],
      table: null,
    })
    expect(getMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      fields:
        'sheets(properties(sheetId,title),tables(tableId,range,columnProperties(columnIndex,columnType)))',
    })
    expect(getMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('resolves a first-tab match whose sheetId is 0 (falsy) without throwing', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 0, title: 'Invoices' }]))
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 0,
      typedColumnIndexes: [],
      table: null,
    })
  })

  it('title match is exact and case-sensitive', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 5, title: 'invoices' }]))
    await expect(resolveSheetTab('S')).rejects.toMatchObject({ code: 'SHEET_TAB_NOT_FOUND' })
  })

  it('no matching title throws the DISTINCT code through the wrapper, naming the expected tab', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 1, title: 'Other' }]))
    const err = await resolveSheetTab('S').catch((e) => e)
    // Not flattened to the generic SHEET_ERROR by sanitize — the match runs outside withRetry.
    expect(err).toMatchObject({ code: 'SHEET_TAB_NOT_FOUND', statusCode: 502 })
    expect(err.message).toContain('"Invoices"')
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })

  it('a null sheetId on the matching tab is treated as not found', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: null, title: 'Invoices' }]))
    await expect(resolveSheetTab('S')).rejects.toMatchObject({ code: 'SHEET_TAB_NOT_FOUND' })
  })

  it('collects Table-typed column indexes from the matched tab (columnIndex omitted = 0)', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              {
                columnProperties: [
                  { columnType: 'DOUBLE' }, // column 0 — API omits columnIndex
                  { columnIndex: 1, columnType: 'DATE' },
                  { columnIndex: 2 }, // untyped — not collected
                  { columnIndex: 5, columnType: 'DROPDOWN' },
                  { columnIndex: 6, columnType: 'DROPDOWN' },
                ],
              },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 0,
      typedColumnIndexes: [0, 1, 5, 6],
      table: null,
    })
  })

  it('retries the lookup on 429 then succeeds; a 400 is not retried', async () => {
    getMock
      .mockRejectedValueOnce({ code: 429 })
      .mockResolvedValueOnce(tabs([{ sheetId: 9, title: 'Invoices' }]))
    await expect(resolveSheetTab('S')).resolves.toMatchObject({ sheetId: 9 })
    expect(getMock).toHaveBeenCalledTimes(2)

    getMock.mockReset().mockRejectedValue({ code: 400 })
    await expect(resolveSheetTab('S')).rejects.toMatchObject({ code: 'SHEET_ERROR' })
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('returns the A1-anchored table — start indexes OMITTED is the anchored case', async () => {
    // The API omits startRowIndex/startColumnIndex when they are 0 (proto3
    // default), so an absent anchor is the table we manage, not a miss.
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 4, title: 'Invoices' },
            tables: [{ tableId: 'tbl-1', range: { sheetId: 4, endRowIndex: 41, endColumnIndex: 10 } }],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 4,
      typedColumnIndexes: [],
      table: { tableId: 'tbl-1', endColumnIndex: 10 },
    })
  })

  it('accepts an anchor written out explicitly as 0', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              {
                tableId: 'tbl-2',
                range: { startRowIndex: 0, startColumnIndex: 0, endRowIndex: 9, endColumnIndex: 10 },
              },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({
      table: { tableId: 'tbl-2', endColumnIndex: 10 },
    })
  })

  it('ignores a table that is not anchored at A1', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              {
                tableId: 'tbl-3',
                range: { startRowIndex: 4, startColumnIndex: 2, endRowIndex: 40, endColumnIndex: 12 },
              },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({ table: null })
  })

  it('picks the anchored table when the tab holds more than one', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              { tableId: 'lower', range: { startRowIndex: 50, endRowIndex: 60, endColumnIndex: 4 } },
              { tableId: 'anchored', range: { endRowIndex: 20, endColumnIndex: 10 } },
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({
      table: { tableId: 'anchored', endColumnIndex: 10 },
    })
  })

  it('ignores an anchored table with no id or no column extent — it cannot be resized', async () => {
    getMock.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Invoices' },
            tables: [
              { range: { endRowIndex: 20, endColumnIndex: 10 } }, // no tableId
              { tableId: 'no-width', range: { endRowIndex: 20 } }, // no endColumnIndex
            ],
          },
        ],
      },
    })
    await expect(resolveSheetTab('S')).resolves.toMatchObject({ table: null })
  })

  it('a tab with no tables at all resolves table: null', async () => {
    getMock.mockResolvedValue(tabs([{ sheetId: 3, title: 'Invoices' }]))
    await expect(resolveSheetTab('S')).resolves.toEqual({
      sheetId: 3,
      typedColumnIndexes: [],
      table: null,
    })
  })
})

describe('sheets.applyColumnDropdowns', () => {
  it('sends one batchUpdate: a leading rows-2+ validation clear, then a ONE_OF_LIST rule per spec', async () => {
    await applyColumnDropdowns('SHEET-1', { sheetId: 123, typedColumnIndexes: [], table: null }, [
      { columnIndex: 6, values: ['PENDING', 'APPROVED', 'PAID'] },
      { columnIndex: 3, values: ['12 Main St'] },
    ])
    expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    expect(batchUpdateMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      requestBody: {
        requests: [
          { setDataValidation: { range: { sheetId: 123, startRowIndex: 1 } } },
          {
            setDataValidation: {
              range: { sheetId: 123, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: 'PENDING' },
                    { userEnteredValue: 'APPROVED' },
                    { userEnteredValue: 'PAID' },
                  ],
                },
                showCustomUi: true,
                strict: true,
              },
            },
          },
          {
            setDataValidation: {
              range: { sheetId: 123, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
              rule: {
                condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: '12 Main St' }] },
                showCustomUi: true,
                strict: true,
              },
            },
          },
        ],
      },
    })
    expect(batchUpdateMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('a spec with an empty values list sets no rule — the leading clear still fires', async () => {
    await applyColumnDropdowns('S', { sheetId: 0, typedColumnIndexes: [], table: null }, [
      { columnIndex: 3, values: [] },
    ])
    const requests = batchUpdateMock.mock.calls[0][0].requestBody.requests
    expect(requests).toEqual([{ setDataValidation: { range: { sheetId: 0, startRowIndex: 1 } } }])
  })

  it('sanitizes a batchUpdate error — never leaks credentials', async () => {
    batchUpdateMock.mockReset().mockRejectedValue({
      code: 403,
      message: 'denied for PRIVATE-SECRET-123',
    })
    const err = await applyColumnDropdowns('S', { sheetId: 1, typedColumnIndexes: [], table: null }, []).catch(
      (e) => e,
    )
    expect(err).toMatchObject({ code: 'SHEET_PERMISSION_DENIED', statusCode: 502 })
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })

  it('retries a transient 503 on batchUpdate then resolves', async () => {
    batchUpdateMock.mockReset().mockRejectedValueOnce({ code: 503 }).mockResolvedValueOnce({})
    await applyColumnDropdowns('S', { sheetId: 1, typedColumnIndexes: [], table: null }, [
      { columnIndex: 0, values: ['A'] },
    ])
    expect(batchUpdateMock).toHaveBeenCalledTimes(2)
  })

  it('skips specs on Table-typed columns — Google rejects classic validation there', async () => {
    await applyColumnDropdowns('S', { sheetId: 0, typedColumnIndexes: [5, 6], table: null }, [
      { columnIndex: 6, values: ['PENDING', 'APPROVED', 'PAID'] }, // typed → skipped
      { columnIndex: 3, values: ['12 Main St'] }, // untyped → set
    ])
    const requests = batchUpdateMock.mock.calls[0][0].requestBody.requests
    expect(requests).toHaveLength(2) // clear + property rule only
    expect(requests[1].setDataValidation.range.startColumnIndex).toBe(3)
  })
})

describe('sheets.resizeTableRows', () => {
  const withTable = {
    sheetId: 123,
    typedColumnIndexes: [],
    table: { tableId: 'tbl-1', endColumnIndex: 10 },
  }

  it('sizes the table to the header plus N data rows in one updateTable', async () => {
    await resizeTableRows('SHEET-1', withTable, 60)
    expect(batchUpdateMock).toHaveBeenCalledTimes(1)
    expect(batchUpdateMock.mock.calls[0][0]).toEqual({
      spreadsheetId: 'SHEET-1',
      requestBody: {
        requests: [
          {
            updateTable: {
              table: {
                tableId: 'tbl-1',
                range: {
                  sheetId: 123,
                  startRowIndex: 0,
                  endRowIndex: 61,
                  startColumnIndex: 0,
                  endColumnIndex: 10,
                },
              },
              fields: 'range',
            },
          },
        ],
      },
    })
    expect(batchUpdateMock.mock.calls[0][1]).toMatchObject({ timeout: 30000 })
  })

  it('SHRINKS with the same request when the invoice count drops', async () => {
    await resizeTableRows('S', withTable, 3)
    const range = batchUpdateMock.mock.calls[0][0].requestBody.requests[0].updateTable.table.range
    expect(range.endRowIndex).toBe(4)
  })

  it('floors at one data row — a table cannot be header-only', async () => {
    await resizeTableRows('S', withTable, 0)
    const range = batchUpdateMock.mock.calls[0][0].requestBody.requests[0].updateTable.table.range
    expect(range.endRowIndex).toBe(2)
  })

  it('does nothing at all when the tab has no anchored table', async () => {
    await resizeTableRows('S', { sheetId: 0, typedColumnIndexes: [], table: null }, 5)
    expect(batchUpdateMock).not.toHaveBeenCalled()
  })

  it('sanitizes a Google failure and never leaks the private key', async () => {
    batchUpdateMock.mockReset().mockRejectedValue({ code: 403, key: 'PRIVATE-SECRET-123' })
    const err = await resizeTableRows('S', withTable, 5).catch((e) => e)
    expect(err).toMatchObject({ code: 'SHEET_PERMISSION_DENIED', statusCode: 502 })
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('PRIVATE-SECRET-123')
  })
})
