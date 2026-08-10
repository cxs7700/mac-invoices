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

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npm run auth:reset-link -- <email>')
    process.exitCode = 1
    return
  }
  const origin = process.env.WEB_ORIGIN
  if (!origin) {
    console.error('WEB_ORIGIN is not set — cannot build a link. Set it in .env and retry.')
    process.exitCode = 1
    return
  }

  const issued = await resetLinkFor(prisma, email, origin)
  if (!issued) {
    console.error(`No account found for ${email}.`)
    process.exitCode = 1
    return
  }

  console.log(`Reset link for ${email} (expires ${issued.expiresAt.toISOString()}):`)
  console.log(issued.url)
  console.log('\nIt works once. Issuing another link retires this one.')
}

main()
  .catch((err) => {
    // Never print the raw error: RESET_LINK_KEY_INVALID carries a safe message,
    // but an unexpected Prisma error can embed the connection string.
    console.error(err instanceof Error ? err.message : 'Failed to issue a reset link.')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
