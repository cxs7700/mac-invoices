import { google } from 'googleapis'
import { AppError } from '../middleware/errorHandler'

// One-way export to Google Sheets via a service account (§8). The handler imports
// this module directly; tests `vi.mock` it. Google errors are NEVER propagated
// raw — they can embed the private_key / client_email, and the central error
// handler logs whatever is thrown (KTD-1b).

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const MAX_ATTEMPTS = 4

// Retry backoff base, read per-call so tests can shrink it via SHEETS_RETRY_BASE_MS.
const baseMs = () => Number(process.env.SHEETS_RETRY_BASE_MS ?? 300)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Read + parse the service-account key, distinguishing unset from malformed. */
function loadCredentials(): Record<string, unknown> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    throw new AppError('EXPORT_NOT_CONFIGURED', 'Sheets export is not configured', 503)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError(
      'EXPORT_NOT_CONFIGURED',
      'Sheets credentials are malformed (check GOOGLE_SERVICE_ACCOUNT_KEY)',
      503,
    )
  }
}

// Read env each call (cheap) so credentials state is always current; GoogleAuth
// caches its own access tokens, so this isn't a hot-path concern at export cadence.
function getSheetsClient() {
  const credentials = loadCredentials()
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
  return google.sheets({ version: 'v4', auth })
}

/** Fully-qualified range on a pinned tab so a multi-tab workbook can't mis-target. */
function tabRange(): string {
  const tab = process.env.GOOGLE_SHEET_TAB ?? 'Invoices'
  return `${tab}!A1`
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; response?: { status?: unknown } }
  const code = typeof e?.code === 'number' ? e.code : e?.response?.status
  return typeof code === 'number' ? code : undefined
}

// gaxios surfaces transport failures with a STRING code and no HTTP status.
const TRANSPORT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK'])
function isTransportError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' && TRANSPORT_CODES.has(code)
}

function isRetryable(err: unknown): boolean {
  const s = statusOf(err)
  if (s === 429 || (s !== undefined && s >= 500 && s < 600)) return true
  // Retry transient network failures (no numeric status).
  return s === undefined && isTransportError(err)
}

/** Neutralize spreadsheet formula injection: a text cell starting with =,+,-,@
 * (or a control char) is forced to literal text with a leading apostrophe. */
function safeCell(value: string | number): string | number {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}

/** Map a Google error to a safe AppError — never leak the raw error/credentials. */
function sanitize(err: unknown): AppError {
  switch (statusOf(err)) {
    case 403:
      return new AppError(
        'SHEET_PERMISSION_DENIED',
        'The service account cannot access the sheet — share it as Editor with the service-account email',
        502,
      )
    case 404:
      return new AppError('SHEET_NOT_FOUND', 'The target spreadsheet was not found', 502)
    case 429:
      return new AppError('SHEET_RATE_LIMITED', 'Google Sheets rate limit exceeded; try again later', 502)
    default:
      return new AppError('SHEET_ERROR', 'Failed to write to Google Sheets', 502)
  }
}

/** Append `rows` to the pinned tab, retrying transient 429/5xx with backoff. */
export async function appendRows(spreadsheetId: string, rows: (string | number)[][]): Promise<void> {
  const sheets = getSheetsClient()
  const safeRows = rows.map((row) => row.map(safeCell))
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sheets.spreadsheets.values.append(
        {
          spreadsheetId,
          range: tabRange(),
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: safeRows },
        },
        // Bound a slow (non-failing) Google call so it can't hang the handler.
        { timeout: 30_000 },
      )
      return
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_ATTEMPTS) {
        const base = baseMs()
        await sleep(2 ** attempt * base + Math.floor(Math.random() * base))
        continue
      }
      throw sanitize(err)
    }
  }
}
