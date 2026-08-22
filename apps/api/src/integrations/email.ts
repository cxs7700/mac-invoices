import { Resend } from 'resend'
import { AppError } from '../middleware/errorHandler'
import { logEvent, type EventLogger } from '../lib/log'

// Transactional email via Resend. The flush imports this module directly; tests
// `vi.mock` it (no live sends = DoD). Provider errors are NEVER propagated raw —
// they can embed the API key, and the central error handler logs whatever is
// thrown (mirrors integrations/sheets.ts).

const MAX_ATTEMPTS = 4
const baseMs = () => Number(process.env.EMAIL_RETRY_BASE_MS ?? 300)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Read the API key + sender, distinguishing unset from present. */
function loadConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new AppError('EMAIL_NOT_CONFIGURED', 'Email notifications are not configured', 503)
  }
  // EMAIL_FROM defaults to Resend's onboarding sender so dev works with no DNS.
  return { apiKey, from: process.env.EMAIL_FROM ?? 'onboarding@resend.dev' }
}

function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: unknown; status?: unknown }
  const code = typeof e?.statusCode === 'number' ? e.statusCode : e?.status
  return typeof code === 'number' ? code : undefined
}

function isRetryable(err: unknown): boolean {
  const s = statusOf(err)
  if (s === 429 || (s !== undefined && s >= 500 && s < 600)) return true
  // Transient transport failure (no HTTP status) — retry.
  return s === undefined && err instanceof Error
}

/** Map any provider error to a safe AppError — never leak the key/raw payload. */
function sanitize(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (statusOf(err) === 429) {
    return new AppError('EMAIL_RATE_LIMITED', 'Email provider rate limit; try again later', 502)
  }
  return new AppError('EMAIL_ERROR', 'Failed to send email', 502)
}

export type EmailMessage = { to: string; subject: string; html: string }

/** Swallows events when no logger was passed, so every emit below stays branch-free. */
const NOOP_LOG: EventLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

/**
 * Send one email, retrying transient 429/5xx with backoff. Resend returns
 * `{ data, error }` (it does not throw on API errors), so a non-null `error` is
 * treated as a failure and routed through the same retry/sanitize path.
 *
 * The optional `log` records only the OUTCOME. The recipient address, the
 * subject and the body are all withheld: `to` is a landlord's email, and the
 * digest subject and body name vendors and count their submissions. An outcome
 * plus the provider's status code is what an operator actually needs to tell
 * "email is down" from "email is off".
 */
export async function sendEmail(
  { to, subject, html }: EmailMessage,
  log?: EventLogger,
): Promise<void> {
  const out = log ?? NOOP_LOG
  const { apiKey, from } = loadConfig()
  const resend = new Resend(apiKey)
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await resend.emails.send({ from, to, subject, html })
      if (error) throw error
      logEvent(out, 'info', { event: 'email.send', outcome: 'ok', count: attempt })
      return
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_ATTEMPTS) {
        const base = baseMs()
        logEvent(out, 'warn', {
          event: 'email.send.retry',
          outcome: 'failed',
          count: attempt,
          statusCode: statusOf(err),
        })
        await sleep(2 ** attempt * base + Math.floor(Math.random() * base))
        continue
      }
      const safe = sanitize(err)
      logEvent(out, 'error', {
        event: 'email.send',
        outcome: 'failed',
        code: safe.code,
        statusCode: statusOf(err),
        count: attempt,
      })
      throw safe
    }
  }
}
