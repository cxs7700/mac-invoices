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
    select: { id: true },
  })
  if (!user) return null

  // Bump and read back in one statement: the returned row carries the version
  // this link is signed with, and a concurrent issue cannot land on the same
  // number. Retiring the previous link is the whole point (R8).
  const bumped = await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetVersion: { increment: 1 } },
    select: { id: true, passwordHash: true, passwordResetVersion: true },
  })

  const expiresAt = new Date(Date.now() + RESET_TTL_MS)
  const token = buildResetToken(
    bumped.id,
    bumped.passwordHash,
    bumped.passwordResetVersion,
    expiresAt.getTime(),
  )
  // Fragment, not a path or query parameter: fragments are not sent in Referer
  // headers and never reach server access logs.
  return { url: `${origin.replace(/\/+$/, '')}/reset-password#t=${token}`, expiresAt }
}
