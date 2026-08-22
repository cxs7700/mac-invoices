// Operational event logging.
//
// The transport (pino, via Fastify) and its secret redaction live in `app.ts`.
// This module is the *field discipline* layer: it decides what an application
// log line is allowed to contain.
//
// The rule is an ALLOW-LIST, not a deny-list. A deny-list of known-bad names
// ("email", "phone") fails open the moment someone logs a field nobody thought
// to ban — and this app's rows are full of vendor names, phone numbers, email
// addresses, property addresses and invoice amounts, all of which would land in
// a third-party log drain unredacted. So `logEvent` emits ONLY the keys in
// `LOG_FIELD_KEYS`, and only when they carry a scalar. Everything else is
// dropped before it reaches pino.
//
// Enforcement is deliberately doubled:
//   - The `LogFields` type has no index signature, so a literal carrying a
//     stray `{ email }` is a compile error.
//   - `logEvent` filters at runtime, so a spread, a cast, or an object built
//     elsewhere cannot smuggle a field past the type checker.
//
// Identifiers ARE logged, but only opaque ones — cuids and the vendor link's
// non-secret `lookupId`. They are pseudonymous: meaningless without database
// access, and necessary for correlating a report with the row it concerns.

/**
 * The complete set of field names an application log line may carry. Adding a
 * key here is a privacy decision — it must be an opaque identifier, a count, a
 * duration, or a stable code, never anything a human could read as a person,
 * a business, a place, or a sum of money.
 */
export const LOG_FIELD_KEYS = [
  'event',
  'outcome',
  'reason',
  'userId',
  'vendorId',
  'invoiceId',
  'propertyId',
  'tokenLookupId',
  'count',
  'durationMs',
  'statusCode',
  'code',
] as const

type LogFieldKey = (typeof LOG_FIELD_KEYS)[number]

const ALLOWED = new Set<string>(LOG_FIELD_KEYS)

/**
 * Fields for one application log line.
 *
 * `event` is a stable dot-name (`auth.login`, `sheets.sync`) — it is both the
 * pino message and a queryable field, so log searches key on it rather than on
 * prose that drifts every time someone edits a string.
 */
export type LogFields = {
  /** Stable dot-name identifying what happened. */
  event: string
  /** How it ended. */
  outcome?: 'ok' | 'denied' | 'failed'
  /**
   * WHY it ended that way, as a short code (`bad_password`, `revoked`). Must
   * match `SAFE_REASON` — free text is replaced, because prose is exactly where
   * a caller would interpolate the email address that failed to resolve.
   */
  reason?: string
  /** Opaque cuid of the acting or affected user. */
  userId?: string
  /** Opaque cuid of the vendor. */
  vendorId?: string
  /** Opaque cuid of the invoice. */
  invoiceId?: string
  /** Opaque cuid of the property. */
  propertyId?: string
  /** The NON-SECRET half of a vendor link token. Never the secret. */
  tokenLookupId?: string
  /** A cardinality — rows processed, users skipped. */
  count?: number
  /** Elapsed milliseconds. */
  durationMs?: number
  /** HTTP status. */
  statusCode?: number
  /** A stable machine code — an `AppError.code`, a Prisma `P2002`. Never a message. */
  code?: string
}

/**
 * A reason must be a CODE: lowercase-ish word characters, dots, dashes. This is
 * what stops `reason: \`no user for ${email}\`` from working.
 */
const SAFE_REASON = /^[A-Za-z0-9_.-]{1,64}$/

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Minimal structural logger, so modules with no Fastify dependency (the digest
 * and Sheets flush jobs) can log through the same discipline. Fastify's
 * `request.log` satisfies it. Mirrors `SyncFlushLogger` in `invoices/sheetSync.ts`.
 */
export type EventLogger = {
  [K in LogLevel]: (obj: object, msg?: string) => void
}

/** Scalars are the only shape a log field may take; an object would serialize its whole graph. */
function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean'
}

/**
 * Emit one application log line, keeping only allow-listed scalar fields.
 *
 * Silently dropping rather than throwing is intentional: a logging call must
 * never be able to fail a request it was only observing. That extends to the
 * logger itself — a partial stub missing the requested level degrades to
 * another level, or to nothing, instead of throwing inside business logic.
 */
export function logEvent(log: EventLogger, level: LogLevel, fields: LogFields): void {
  const safe: Partial<Record<LogFieldKey, string | number | boolean>> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || !isScalar(value)) continue
    if (key === 'reason' && !(typeof value === 'string' && SAFE_REASON.test(value))) {
      safe.reason = 'unsafe_reason'
      continue
    }
    safe[key as LogFieldKey] = value
  }
  const emit = log[level] ?? log.warn ?? log.info ?? log.error ?? log.debug
  if (typeof emit === 'function') emit.call(log, safe, fields.event)
}

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

/**
 * Pick the pino level from the environment.
 *
 * Tests default to `silent` — the suite drives hundreds of requests through
 * `app.inject()` and a full `info` stream buries the actual assertions. An
 * explicit `LOG_LEVEL` still wins, so a failing test can be re-run noisily.
 * An unrecognised value falls back to `info` instead of throwing: a typo in a
 * deploy's env should not take the API down.
 */
export function resolveLogLevel(env: { LOG_LEVEL?: string; NODE_ENV?: string }): string {
  const explicit = env.LOG_LEVEL?.trim().toLowerCase()
  if (explicit && LEVELS.has(explicit)) return explicit
  if (explicit) return 'info'
  if (env.NODE_ENV === 'test') return 'silent'
  return 'info'
}
