import type { FastifyRequest, FastifyReply } from 'fastify'
import { UpdateProfileSchema, ChangePasswordSchema } from '@mac-invoices/shared'
import { parseBody } from '../lib/validate'
import { AppError } from '../middleware/errorHandler'
import { hashPassword, verifyPassword } from '../auth/password'
import { sessionIdFromToken } from '../auth/session'
import { SESSION_COOKIE } from '../auth/requireAuth'

// Landlord self-serve settings, all scoped to the session user. Responses never
// include the password hash or any secret (DEC-019 / R10).

const accountSelect = { id: true, email: true, name: true, role: true } as const

/**
 * PATCH /api/settings/profile — edit the display name (email is read-only). Any
 * email field in the body is ignored. Returns the updated account.
 */
export async function updateProfile(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(UpdateProfileSchema, request.body)
  const account = await request.server.prisma.user.update({
    where: { id: request.user.id },
    data: { name: input.name },
    select: accountSelect,
  })
  return reply.send(account)
}

/**
 * POST /api/settings/password — change the password. Requires the current
 * password (argon2id verify) as re-auth; on success updates the hash and logs
 * out every OTHER session (keeping the current cookie alive), so a password
 * change kicks out anyone else (KTD-2).
 */
export async function changePassword(request: FastifyRequest, reply: FastifyReply) {
  const { currentPassword, newPassword } = parseBody(ChangePasswordSchema, request.body)
  const prisma = request.server.prisma

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.id },
    select: { passwordHash: true },
  })
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError('UNAUTHORIZED', 'Current password is incorrect', 401)
  }

  const passwordHash = await hashPassword(newPassword)
  const token = request.cookies?.[SESSION_COOKIE]
  const currentSessionId = token ? sessionIdFromToken(token) : null

  await prisma.$transaction([
    prisma.user.update({ where: { id: request.user.id }, data: { passwordHash } }),
    // Invalidate every other session; the current one (if any) stays valid.
    prisma.session.deleteMany({
      where: {
        userId: request.user.id,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
    }),
  ])
  return reply.code(204).send()
}
