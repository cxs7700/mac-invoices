import { google, type sheets_v4 } from 'googleapis'
import { AppError } from '../middleware/errorHandler'
import { SheetFormula, type SheetCell, type ColumnDropdownSpec } from './sheetCells'

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

/** The pinned tab name (a clear targets the whole tab, an update anchors at A1). */
function tabName(): string {
  return process.env.GOOGLE_SHEET_TAB ?? 'Invoices'
}

/** Fully-qualified range on a pinned tab so a multi-tab workbook can't mis-target. */
function tabRange(): string {
  return `${tabName()}!A1`
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; response?: { status?: unknown } }
  const code = typeof e?.code === 'number' ? e.code : e?.response?.status
  return typeof code === 'number' ? code : undefined
}

// gaxios surfaces transport failures with a STRING code and no HTTP status.
const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_NETWORK',
])
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
 * (or a control char) is forced to literal text with a leading apostrophe.
 * A SheetFormula is the one exception — a server-constructed formula that
 * passes through verbatim (USER_ENTERED then evaluates it). */
function safeCell(value: SheetCell): string | number {
  if (value instanceof SheetFormula) return value.formula
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
      return new AppError(
        'SHEET_RATE_LIMITED',
        'Google Sheets rate limit exceeded; try again later',
        502,
      )
    default:
      return new AppError('SHEET_ERROR', 'Failed to write to Google Sheets', 502)
  }
}

/**
 * The service-account's email (`client_email`) — the address a landlord shares
 * their sheet with as Editor. This is NON-secret (the private_key is never
 * exposed); safe to surface in the settings UI. Throws the same 503 as the
 * export when credentials are unset/malformed.
 */
export function serviceAccountEmail(): string {
  const email = loadCredentials().client_email
  return typeof email === 'string' ? email : ''
}

/**
 * Verify the service account can reach a spreadsheet — a metadata read
 * (`spreadsheets.get`), NOT an append, so a "test connection" never mutates the
 * sheet. Resolves on success; throws a sanitized AppError (e.g. the share-as-
 * Editor 403 message) on failure, never a raw provider error.
 */
export async function checkAccess(spreadsheetId: string): Promise<void> {
  const sheets = getSheetsClient()
  try {
    await sheets.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' }, { timeout: 30_000 })
  } catch (err) {
    throw sanitize(err)
  }
}

/** Run a single Google call with the retry/backoff + sanitize policy shared by
 * every write: retry transient 429/5xx/transport errors with exponential backoff
 * + jitter, then surface a sanitized AppError (never the raw provider error).
 * Returns the call's result so read calls (e.g. the tab lookup) share the policy. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await call()
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_ATTEMPTS) {
        const base = baseMs()
        await sleep(2 ** attempt * base + Math.floor(Math.random() * base))
        continue
      }
      throw sanitize(err)
    }
  }
  // Unreachable: every iteration returns or throws; the last attempt never continues.
  throw sanitize(undefined)
}

/** The pinned tab's grid id, the column indexes a Sheets "Table" has given a
 * type (DOUBLE, DATE, DROPDOWN, …), and the table itself when one is anchored
 * at A1. Typed columns reject classic data validation ("not allowed on cells in
 * typed columns"), so rule specs for them are skipped — their dropdowns come
 * from the table's own column type. */
export type SheetTable = { tableId: string; endColumnIndex: number }
export type SheetTab = {
  sheetId: number
  typedColumnIndexes: number[]
  table: SheetTable | null
}

/**
 * The one table this mirror manages: the table anchored at A1, which is the
 * only geometry the mirror's `A1` values write aligns with. A table elsewhere
 * on the tab (or a second table below the data) is left entirely alone.
 *
 * A GridRange OMITS startRowIndex/startColumnIndex when they are 0 (proto3
 * default) — so an absent anchor IS the anchored case, not a miss. Reading
 * absence as "not anchored" would silently disable the resize for precisely
 * the tables it exists to serve. Same trap as `columnIndex ?? 0` below.
 *
 * A table with no id, or no column extent, cannot be addressed or resized, so
 * it is treated as absent.
 */
function anchoredTable(
  tables: NonNullable<sheets_v4.Schema$Sheet['tables']>,
): SheetTable | null {
  for (const t of tables) {
    const range = t.range
    if (!range) continue
    if ((range.startRowIndex ?? 0) !== 0 || (range.startColumnIndex ?? 0) !== 0) continue
    if (typeof t.tableId !== 'string' || typeof range.endColumnIndex !== 'number') continue
    return { tableId: t.tableId, endColumnIndex: range.endColumnIndex }
  }
  return null
}

/**
 * Resolve the pinned tab — its numeric grid sheetId (gid, required by
 * `setDataValidation`, which has no A1-notation form) and any Table-typed
 * column indexes. The `spreadsheets.get` runs inside the shared retry/sanitize
 * policy, but the title match happens OUT here: `sanitize` flattens anything
 * thrown inside `withRetry` to a generic code, and a tab-title miss must
 * surface as its own distinct, actionable error BEFORE any destructive write.
 * An exact, case-sensitive title match is intentional (tab names are
 * operator-pinned via GOOGLE_SHEET_TAB). sheetId 0 (the first tab) is valid —
 * only null/undefined mean "no match".
 */
export async function resolveSheetTab(spreadsheetId: string): Promise<SheetTab> {
  const sheets = getSheetsClient()
  const res = await withRetry(() =>
    sheets.spreadsheets.get(
      {
        spreadsheetId,
        fields:
          'sheets(properties(sheetId,title),tables(tableId,range,columnProperties(columnIndex,columnType)))',
      },
      { timeout: 30_000 },
    ),
  )
  const match = res.data.sheets?.find((s) => s.properties?.title === tabName())
  const sheetId = match?.properties?.sheetId
  if (sheetId == null) {
    throw new AppError(
      'SHEET_TAB_NOT_FOUND',
      `The spreadsheet has no "${tabName()}" tab — create it (or fix GOOGLE_SHEET_TAB) and sync again`,
      502,
    )
  }
  // The API omits columnIndex for column 0 (proto3 default) — hence the ?? 0.
  const typedColumnIndexes = (match?.tables ?? []).flatMap((t) =>
    (t.columnProperties ?? []).filter((c) => c.columnType != null).map((c) => c.columnIndex ?? 0),
  )
  return { sheetId, typedColumnIndexes, table: anchoredTable(match?.tables ?? []) }
}

/**
 * Apply dropdown (data-validation) rules to the mirrored tab in ONE atomic
 * `batchUpdate`: first clear ALL validation from the data rows (rules survive
 * `values.clear`, so rules from an older column layout would otherwise linger on
 * shifted columns), then set a ONE_OF_LIST rule per spec from row 2 downward,
 * unbounded, so rows added by later syncs stay covered. Specs with empty value
 * lists set no rule (an empty ONE_OF_LIST is a Google 400) — the leading clear
 * still covers their columns. Specs on Table-typed columns are skipped the same
 * way: Google rejects classic validation there, and the table's own column type
 * (e.g. DROPDOWN) already provides the dropdown. `strict` only affects
 * interactive edits; the mirror's own `values.update` writes bypass validation.
 */
export async function applyColumnDropdowns(
  spreadsheetId: string,
  tab: SheetTab,
  specs: ColumnDropdownSpec[],
): Promise<void> {
  const sheets = getSheetsClient()
  const { sheetId } = tab
  const requests: sheets_v4.Schema$Request[] = [
    { setDataValidation: { range: { sheetId, startRowIndex: 1 } } },
    ...specs
      .filter(
        (spec) => spec.values.length > 0 && !tab.typedColumnIndexes.includes(spec.columnIndex),
      )
      .map((spec) => ({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: spec.columnIndex,
            endColumnIndex: spec.columnIndex + 1,
          },
          rule: {
            condition: {
              type: 'ONE_OF_LIST',
              values: spec.values.map((v) => ({ userEnteredValue: v })),
            },
            showCustomUi: true,
            strict: true,
          },
        },
      })),
  ]
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate(
      { spreadsheetId, requestBody: { requests } },
      { timeout: 30_000 },
    ),
  )
}

/**
 * Size the tab's anchored Sheets Table to exactly the rows the mirror is about
 * to write — header + `dataRowCount` — in one `updateTable`. GROWS and SHRINKS:
 * the sheet is a full mirror that clears the tab every pass (DEC-001), so a
 * table left stretched over just-cleared rows would render as empty banded rows
 * carrying stale typed-column validation. Deleted rows remain recoverable from
 * Google's own version history; Postgres stays the source of truth.
 *
 * A no-op when the tab has no A1-anchored table — the mirror then behaves as a
 * plain values writer, which is the whole behavior for landlords who never made
 * a table. The column extent is the table's own: this resizes rows, and never
 * silently re-widens or narrows a landlord's columns.
 *
 * `Math.max(dataRowCount, 1)` because a table cannot be header-only — a landlord
 * with zero exportable invoices would otherwise trigger a Google 400.
 */
export async function resizeTableRows(
  spreadsheetId: string,
  tab: SheetTab,
  dataRowCount: number,
): Promise<void> {
  const { table } = tab
  if (!table) return
  const sheets = getSheetsClient()
  const requests: sheets_v4.Schema$Request[] = [
    {
      updateTable: {
        table: {
          tableId: table.tableId,
          range: {
            sheetId: tab.sheetId,
            startRowIndex: 0,
            endRowIndex: 1 + Math.max(dataRowCount, 1),
            startColumnIndex: 0,
            endColumnIndex: table.endColumnIndex,
          },
        },
        fields: 'range',
      },
    },
  ]
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate(
      { spreadsheetId, requestBody: { requests } },
      { timeout: 30_000 },
    ),
  )
}

/** Append `rows` to the pinned tab, retrying transient 429/5xx with backoff. */
export async function appendRows(spreadsheetId: string, rows: SheetCell[][]): Promise<void> {
  const sheets = getSheetsClient()
  const safeRows = rows.map((row) => row.map(safeCell))
  await withRetry(() =>
    sheets.spreadsheets.values.append(
      {
        spreadsheetId,
        range: tabRange(),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: safeRows },
      },
      // Bound a slow (non-failing) Google call so it can't hang the handler.
      { timeout: 30_000 },
    ),
  )
}

/**
 * Replace the pinned tab's entire contents with `rows` — the continuous-sync
 * full mirror. Clears the tab, sizes the tab's Sheets Table to fit (a no-op when
 * there is no anchored table), THEN writes (`values.update` at A1), so deleted
 * invoices vanish and edits land in place; pass a header row as `rows[0]` since
 * the clear wipes any operator-added header. The resize sits BETWEEN the clear
 * and the write on purpose: it mirrors what a person does in the UI — extend the
 * table, then type into rows that are born formatted — and it means
 * `values.update` writes into columns that already carry their types, rather
 * than asking Google to retro-fit a type onto text it never validated.
 *
 * Each Google call carries the shared retry/backoff + sanitize policy. NOT
 * atomic across the calls: a failure after the clear leaves the tab empty, but
 * the caller is the cron mirror which re-runs idempotently (the user stays
 * "dirty" until a full pass succeeds).
 */
export async function overwriteRows(
  spreadsheetId: string,
  rows: SheetCell[][],
  tab: SheetTab,
): Promise<void> {
  const sheets = getSheetsClient()
  const safeRows = rows.map((row) => row.map(safeCell))
  await withRetry(() =>
    sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName() }, { timeout: 30_000 }),
  )
  // rows[0] is the header, which lives inside the table but is not a data row.
  await resizeTableRows(spreadsheetId, tab, Math.max(safeRows.length - 1, 0))
  await withRetry(() =>
    sheets.spreadsheets.values.update(
      {
        spreadsheetId,
        range: tabRange(),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: safeRows },
      },
      { timeout: 30_000 },
    ),
  )
}
