import type { PrismaClient } from '../../prisma/generated/client.ts'
import { buildResetToken, RESET_TTL_MS } from './resetToken'

export type IssuedResetLink = { url: string; expiresAt: Date }

/**
 * Derive a reset link for `email`, or null when no such account exists.
 *
 * This one DOES distinguish a missing account, unlike the public endpoint that
 * consumes the link: the caller here is the operator at their own terminal, and
 * a silent success would have them send someone a link that can never work.
 *
 * Email is normalized the same way `EmailSchema` does (trim + lowercase), so an
 * address typed with different casing still finds the account.
 */
export async function resetLinkFor(
  prisma: PrismaClient,
  email: string,
  origin: string,
): Promise<IssuedResetLink | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true },
  })
  if (!user) return null

  const expiresAt = new Date(Date.now() + RESET_TTL_MS)
  const token = buildResetToken(user.id, user.passwordHash, expiresAt.getTime())
  // Fragment, not a path or query parameter: fragments are not sent in Referer
  // headers and never reach server access logs.
  return { url: `${origin.replace(/\/+$/, '')}/reset-password#t=${token}`, expiresAt }
}
