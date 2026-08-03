import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock googleapis so no network call happens.
const appendMock = vi.fn()
const clearMock = vi.fn()
const updateMock = vi.fn()
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: vi.fn(() => ({})) },
    sheets: vi.fn(() => ({
      spreadsheets: { values: { append: appendMock, clear: clearMock, update: updateMock } },
    })),
  },
}))

import { appendRows, overwriteRows } from '../../src/integrations/sheets'
import { SheetFormula } from '../../src/integrations/sheetCells'

const VALID_KEY = JSON.stringify({ client_email: 'sa@x.iam', private_key: 'PRIVATE-SECRET-123' })

beforeEach(() => {
  appendMock.mockReset()
  clearMock.mockReset().mockResolvedValue({})
  updateMock.mockReset().mockResolvedValue({})
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
      "'=IMPORTXML(\"http://evil\")",
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
      "'=HYPERLINK(\"http://evil\")",
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
    updateMock.mockReset().mockRejectedValue({ code: 403, message: 'no access to PRIVATE-SECRET-123' })
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
