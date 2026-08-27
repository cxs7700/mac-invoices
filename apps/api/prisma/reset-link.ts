import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import '../src/lib/loadEnv.ts'
import { prisma } from '../src/lib/prisma'
import { resetLinkFor } from '../src/auth/resetLink'

// Issue a password-reset link for one account:
//   npm run auth:reset-link -- someone@example.com
//
// Deliberately a local script and not an in-app screen: this app has no
// administrator role (every User is a landlord tenant), so an in-app issuer
// would let any landlord take over any other landlord's account. Whoever can
// run this can already edit the database directly, so it grants nothing new.

export type TargetDescription = { host: string; pathname: string; isLocal: boolean }

/**
 * Describe which database `databaseUrl` points at, WITHOUT ever returning
 * anything secret. `URL` parsing (not string-splitting) is what keeps this
 * honest: user, password, and query string — which on Prisma Postgres carries
 * an API key — are simply never read out of the object.
 *
 * Returns null if the value doesn't parse as a URL at all (still no leak: the
 * caller only ever sees "unparseable", not the raw string).
 */
export function describeTarget(databaseUrl: string): TargetDescription | null {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    return null
  }
  const host = parsed.hostname
  return {
    host,
    pathname: parsed.pathname,
    isLocal: host === 'localhost' || host === '127.0.0.1',
  }
}

/** First 8 hex chars of sha256(key) — enough to compare "same key?" across two
 * terminals without either terminal ever printing the key itself. */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8)
}

async function main() {
  const email = process.argv[2]
  const args = process.argv.slice(3)
  const yesProduction = args.includes('--yes-production')

  if (!email) {
    console.error('Usage: npm run auth:reset-link -- <email> [--yes-production]')
    process.exitCode = 1
    return
  }
  const origin = process.env.WEB_ORIGIN
  if (!origin) {
    console.error('WEB_ORIGIN is not set — cannot build a link. Set it in .env and retry.')
    process.exitCode = 1
    return
  }

  // Name the target BEFORE minting anything: a live credential with no
  // indication of which database it hit is undiagnosable, and the default
  // DATABASE_URL is production.
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const target = describeTarget(databaseUrl)
  const keyFp = process.env.RESET_LINK_KEY ? keyFingerprint(process.env.RESET_LINK_KEY) : null

  if (!target) {
    console.error(
      'DATABASE_URL is not set or is not a valid URL — cannot tell which database this would hit.',
    )
    process.exitCode = 1
    return
  }

  console.log(`Target database: ${target.host}${target.pathname}`)
  console.log(`RESET_LINK_KEY fingerprint: ${keyFp ?? '(unset)'}`)
  console.log(
    'Compare both against the target environment (e.g. Vercel) before sending the link — a ' +
      'mismatched key rejects every link as invalid with no distinguishing error.',
  )

  if (!target.isLocal && !yesProduction) {
    console.error(
      `\nDATABASE_URL points at a non-local host (${target.host}). This would read and write ` +
        'that database and mint a live credential for it. Re-run with --yes-production if that ' +
        'is really what you want. Nothing has been minted.',
    )
    process.exitCode = 1
    return
  }

  const issued = await resetLinkFor(prisma, email, origin)
  if (!issued) {
    console.error(`No account found for ${email}.`)
    process.exitCode = 1
    return
  }

  console.log(`\nReset link for ${email} (expires ${issued.expiresAt.toISOString()}):`)
  console.log(issued.url)
  console.log('\nIt works once. Issuing another link retires this one.')
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main()
    .catch((err) => {
      // Never print the raw error: RESET_LINK_KEY_INVALID carries a safe message,
      // but an unexpected Prisma error can embed the connection string.
      console.error(err instanceof Error ? err.message : 'Failed to issue a reset link.')
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
