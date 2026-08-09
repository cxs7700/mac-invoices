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

const accountSelect = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  role: true,
  locale: true,
} as const

/** `[firstName, lastName]` joined, or null if both are empty — the generic
 * display name consumed by event actors and the invoice `user` embed. */
function displayName(firstName: string | null, lastName: string | null): string | null {
  const joined = [firstName, lastName].filter(Boolean).join(' ')
  return joined || null
}

/**
 * PATCH /api/settings/profile — edit first/last name, email, and/or UI locale.
 * `name` (the generic display name read by event actors and the invoice `user`
 * embed) is kept in sync with firstName+lastName on every write. Email has no
 * verification flow (KTD); a duplicate 409s via the central P2002 handling.
 * Returns the updated account.
 */
export async function updateProfile(request: FastifyRequest, reply: FastifyReply) {
  const input = parseBody(UpdateProfileSchema, request.body)
  const prisma = request.server.prisma
  // "" clears lastName to null (a landlord with no last name to give);
  // `undefined` leaves it unchanged (the PATCH-just-one-field contract).
  const lastNameInput = input.lastName === '' ? null : input.lastName

  const account = await prisma.$transaction(async (tx) => {
    let nameUpdate = {}
    if (input.firstName !== undefined || lastNameInput !== undefined) {
      // `FOR UPDATE` (not a plain read): two concurrent PATCHes touching
      // disjoint name fields (firstName-only vs. lastName-only) must not
      // both read the same pre-update row — the row lock forces the second
      // transaction to wait and then read the FIRST transaction's committed
      // result, so its write layers on top instead of clobbering it with a
      // stale snapshot.
      const [current] = await tx.$queryRaw<{ firstName: string | null; lastName: string | null }[]>`
        SELECT "firstName", "lastName" FROM "users" WHERE id = ${request.user.id} FOR UPDATE`
      const firstName = input.firstName !== undefined ? input.firstName : current.firstName
      const lastName = lastNameInput !== undefined ? lastNameInput : current.lastName
      nameUpdate = { firstName, lastName, name: displayName(firstName, lastName) }
    }

    return tx.user.update({
      where: { id: request.user.id },
      data: {
        ...nameUpdate,
        ...(input.email !== undefined && { email: input.email }),
        ...(input.locale !== undefined && { locale: input.locale }),
      },
      select: accountSelect,
    })
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

/** The session user's effective Sheets target: their saved id, or null if
 * they have not connected a sheet. There is no server-side fallback. */
async function effectiveTarget(request: FastifyRequest): Promise<string | null> {
  const user = await request.server.prisma.user.findUniqueOrThrow({
    where: { id: request.user.id },
    select: { sheetSpreadsheetId: true },
  })
  return user.sheetSpreadsheetId
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

/**
 * PATCH /api/settings/sheets — save the per-landlord target spreadsheet id.
 *
 * The UNIQUE index on `users.sheetSpreadsheetId` is the authority, and this
 * catch is only its translator. Deliberately NOT a read-then-write "is it
 * taken?" check: two concurrent saves would both read the id as free and both
 * proceed, which is exactly the collision the constraint exists to prevent.
 * The message never names the other account (DEC-033).
 */
export async function saveSheet(request: FastifyRequest, reply: FastifyReply) {
  // The third argument overrides parseBody's default "Invalid request body".
  // It matters: the central errorHandler puts the Zod message in `details`,
  // and the web Settings page renders `error.message` only — so without this
  // the landlord sees "Invalid request body" and never learns what shape the
  // field wants. Every way this parse can fail (not an id, not a Sheets URL,
  // over 500 chars) is fairly described by this one sentence.
  const { spreadsheetId } = parseBody(
    SaveSheetSchema,
    request.body,
    "That doesn't look like a Google Sheets ID or URL",
  )
  try {
    await request.server.prisma.user.update({
      where: { id: request.user.id },
      data: { sheetSpreadsheetId: spreadsheetId },
    })
  } catch (err) {
    // `sheetSpreadsheetId` is the only unique column this update touches, so a
    // P2002 here can only mean another account already holds this spreadsheet.
    if ((err as { code?: unknown })?.code === 'P2002') {
      throw new AppError(
        'SHEET_ALREADY_CONNECTED',
        'That spreadsheet is already connected to another account. Please use a different one.',
        409,
      )
    }
    throw err
  }
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
