import type { FastifyRequest, FastifyReply } from 'fastify'
import { UpdateProfileSchema, ChangePasswordSchema, SaveSheetSchema } from '@mac-invoices/shared'
import { parseBody } from '../lib/validate'
import { AppError } from '../middleware/errorHandler'
import { hashPassword, verifyPassword } from '../auth/password'
import { sessionIdFromToken } from '../auth/session'
import { SESSION_COOKIE } from '../auth/requireAuth'
import { serviceAccountEmail, checkAccess } from '../integrations/sheets'

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

/** The landlord's effective Sheets target: their saved id, else the env default. */
async function effectiveTarget(request: FastifyRequest): Promise<string | null> {
  const user = await request.server.prisma.user.findUniqueOrThrow({
    where: { id: request.user.id },
    select: { sheetSpreadsheetId: true },
  })
  return user.sheetSpreadsheetId ?? process.env.GOOGLE_SHEET_ID ?? null
}

/**
 * GET /api/settings/sheets — connection status: whether credentials are
 * configured, the service-account email to share with, the effective target,
 * and whether the service account can actually reach it. Never returns the key.
 */
export async function getSheets(request: FastifyRequest, reply: FastifyReply) {
  let configured = true
  let email: string | null = null
  try {
    email = serviceAccountEmail()
  } catch {
    configured = false // credentials unset/malformed → report cleanly, don't crash
  }
  const targetSpreadsheetId = await effectiveTarget(request)
  let reachable = false
  if (configured && targetSpreadsheetId) {
    reachable = await checkAccess(targetSpreadsheetId).then(() => true).catch(() => false)
  }
  return reply.send({ configured, serviceAccountEmail: email, targetSpreadsheetId, reachable })
}

/** PATCH /api/settings/sheets — save the per-landlord target spreadsheet id. */
export async function saveSheet(request: FastifyRequest, reply: FastifyReply) {
  const { spreadsheetId } = parseBody(SaveSheetSchema, request.body)
  await request.server.prisma.user.update({
    where: { id: request.user.id },
    data: { sheetSpreadsheetId: spreadsheetId },
  })
  return getSheets(request, reply)
}

/**
 * POST /api/settings/sheets/test — verify the service account can reach the
 * effective target (a metadata read, no write). Propagates the sanitized
 * share-as-Editor error on failure (never a raw provider error).
 */
export async function testSheet(request: FastifyRequest, reply: FastifyReply) {
  const target = await effectiveTarget(request)
  if (!target) {
    throw new AppError('VALIDATION_ERROR', 'No target spreadsheet set', 400)
  }
  await checkAccess(target) // throws the sanitized AppError on failure
  return reply.send({ ok: true })
}
